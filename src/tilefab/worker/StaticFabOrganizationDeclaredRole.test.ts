import { describe, expect, it } from "vitest";
import { completeCooperativeSteps } from "../core/CooperativeTask";
import { RailDocument } from "../core/RailDocument";
import {
	applyStaticFabOrganizationMutations,
	applyStaticFabOrganizationMutationsSteps,
	copyStaticFabOrganizationRecord,
	copyStaticFabOrganizationState,
	deriveStaticFabOrganizationSemanticRoles,
	renameStaticFabOrganizationRecord,
	replaceStaticFabOrganizationRecordMembership,
	staticFabOrganizationRecordEquals,
} from "../core/StaticFabOrganization";
import {
	checksumRailMap,
	checksumRailMapCooperatively,
	checksumRailMapLegacyVersionTwo,
	RailChecksumAccumulator,
} from "./RailMirrorChecksum";
import {
	createStaticFabOrganizationSnapshot,
	decodeStaticFabOrganizationPatch,
	encodeStaticFabOrganizationPatch,
	encodeStaticFabOrganizationPatchCooperatively,
	hydrateStaticFabOrganizationDiagnosticSnapshot,
	hydrateStaticFabOrganizationSnapshot,
	STATIC_FAB_ORGANIZATION_PATCH_OPERATIONS,
	staticFabOrganizationSnapshotTransfers,
	validateStaticFabOrganizationSnapshotStructure,
} from "./StaticFabOrganizationSoA";

const legacy = () =>
	copyStaticFabOrganizationRecord({
		id: 1,
		kind: "AISLE",
		name: "Standalone",
		membership: {
			railEdges: [{ from: { x: 0, y: 0 }, to: { x: 1, y: 0 } }],
			advancedSwitchIds: [],
			equipmentGroupIds: [],
		},
	});
const declared = () =>
	copyStaticFabOrganizationRecord({ ...legacy(), declaredSemanticRole: "PROCESS_LOOP" });

describe("explicit standalone process-loop contract", () => {
	it("normalizes missing intent to null without inferring roles from an AISLE name or shape", () => {
		const record = legacy();
		expect(record).toHaveProperty("declaredSemanticRole", null);
		expect(
			deriveStaticFabOrganizationSemanticRoles({ records: [record], nextOrganizationId: 2 }).get(1),
		).toBeUndefined();
		expect(
			deriveStaticFabOrganizationSemanticRoles({
				records: [declared()],
				nextOrganizationId: 2,
			}).get(1),
		).toBe("PROCESS_LOOP");
		for (const kind of ["AREA", "BAY"] as const) {
			expect(() => copyStaticFabOrganizationRecord({ ...declared(), kind })).toThrow();
		}
	});

	it("preserves intent through metadata, membership replacement and reversible canonical mutation", () => {
		const record = declared();
		expect(renameStaticFabOrganizationRecord(record, "Renamed").declaredSemanticRole).toBe(
			"PROCESS_LOOP",
		);
		expect(
			replaceStaticFabOrganizationRecordMembership(record, record.membership).declaredSemanticRole,
		).toBe("PROCESS_LOOP");
		expect(staticFabOrganizationRecordEquals(record, legacy())).toBe(false);
		const source = copyStaticFabOrganizationState({ records: [legacy()], nextOrganizationId: 2 });
		const before = source.records[0];
		if (!before) throw new Error("Missing source");
		const result = applyStaticFabOrganizationMutations(
			source,
			[{ id: 1, before, after: record }],
			2,
		);
		expect(result.records[0]?.declaredSemanticRole).toBe("PROCESS_LOOP");
		expect(
			completeCooperativeSteps(
				applyStaticFabOrganizationMutationsSteps(
					source,
					Object.freeze([Object.freeze({ id: 1, before, after: record })]),
					2,
				),
			),
		).toEqual(result);
		expect(
			applyStaticFabOrganizationMutations(result, [{ id: 1, before: record, after: before }], 2),
		).toEqual(source);
	});

	it("transfers intent in a dedicated owned column and rejects malformed strict rows", () => {
		const snapshot = createStaticFabOrganizationSnapshot({
			records: [declared()],
			nextOrganizationId: 2,
		});
		expect([...snapshot.records.declaredSemanticRoles]).toEqual([1]);
		expect(staticFabOrganizationSnapshotTransfers(snapshot)).toContain(
			snapshot.records.declaredSemanticRoles.buffer,
		);
		expect(
			hydrateStaticFabOrganizationSnapshot(structuredClone(snapshot)).records[0]
				?.declaredSemanticRole,
		).toBe("PROCESS_LOOP");
		for (const code of [2, 255]) {
			const malformed = structuredClone(snapshot);
			malformed.records.declaredSemanticRoles[0] = code;
			expect(() => validateStaticFabOrganizationSnapshotStructure(malformed)).toThrow();
			expect(
				hydrateStaticFabOrganizationDiagnosticSnapshot(malformed).records[0]?.declaredSemanticRole,
			).toBe(`INVALID_ROLE_${code}`);
		}
		const wrongKind = structuredClone(snapshot);
		wrongKind.records.kinds[0] = 0;
		expect(() => validateStaticFabOrganizationSnapshotStructure(wrongKind)).toThrow(/AISLE/);
		expect(() => hydrateStaticFabOrganizationDiagnosticSnapshot(wrongKind)).not.toThrow();
		const wrongWidth = {
			...snapshot,
			records: {
				...snapshot.records,
				declaredSemanticRoles: new Uint16Array([1]) as unknown as Uint8Array,
			},
		};
		expect(() => validateStaticFabOrganizationSnapshotStructure(wrongWidth)).toThrow();
		const wrongLength = {
			...snapshot,
			records: { ...snapshot.records, declaredSemanticRoles: new Uint8Array() },
		};
		expect(() => validateStaticFabOrganizationSnapshotStructure(wrongLength)).toThrow();
	});

	it("requires FULL rows for role changes even when compact metadata encoding is requested", async () => {
		const before = legacy(),
			after = declared();
		const mutations = Object.freeze([Object.freeze({ id: 1, before, after })]);
		const encoded = encodeStaticFabOrganizationPatch(mutations, 2, 2, { compactExisting: true });
		expect([...encoded.fields.operationCodes]).toEqual([
			STATIC_FAB_ORGANIZATION_PATCH_OPERATIONS.FULL,
		]);
		expect(decodeStaticFabOrganizationPatch(encoded.fields)).toEqual(mutations);
		const cooperative = await encodeStaticFabOrganizationPatchCooperatively(
			mutations,
			2,
			2,
			async () => undefined,
			1,
		);
		expect(cooperative.fields).toEqual(encoded.fields);
	});

	it("uses current v3 authority, preserves the legacy null contribution and hashes declared intent", async () => {
		const document = new RailDocument();
		const plain = { records: [legacy()], nextOrganizationId: 2 };
		const explicit = { records: [declared()], nextOrganizationId: 2 };
		const current = checksumRailMap(document.map, document.portEquipment, plain);
		const old = checksumRailMapLegacyVersionTwo(document.map, document.portEquipment, plain);
		expect(current.slice(0, 8)).toBe("00000003");
		expect(old.slice(0, 8)).toBe("00000002");
		expect(old.slice(8)).toBe(current.slice(8));
		expect(() => RailChecksumAccumulator.fromDigest(old)).toThrow();
		expect(() =>
			checksumRailMapLegacyVersionTwo(document.map, document.portEquipment, explicit),
		).toThrow();
		expect(checksumRailMap(document.map, document.portEquipment, explicit)).not.toBe(current);
		expect(
			await checksumRailMapCooperatively(
				document.map,
				document.portEquipment,
				explicit,
				async () => undefined,
				1,
			),
		).toBe(checksumRailMap(document.map, document.portEquipment, explicit));
	});
});
