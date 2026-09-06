import { describe, expect, it } from "vitest";
import type { RailAreaStampTemplate } from "../core/RailAreaStamp";
import {
	createOpenFabRailAreaBlueprint,
	updateOpenFabProjectBlueprint,
} from "./OpenFabBlueprintLibrary";
import {
	createOpenFabUserBlueprintRecord,
	OpenFabUserBlueprintParseError,
	openFabUserBlueprintRecordJsonByteLength,
	updateOpenFabUserBlueprintRecord,
} from "./OpenFabUserBlueprintLibrary";
import {
	createOpenFabUserBlueprintLibraryBundle,
	createOpenFabUserBlueprintLibraryReplaceImpact,
	createOpenFabUserBlueprintLibraryRestorePreflight,
	OPENFAB_USER_BLUEPRINT_RESTORE_GENERATED_ID_LENGTH,
	openFabUserBlueprintRecordsEqual,
	parseOpenFabUserBlueprintLibraryBundleJson,
	planOpenFabUserBlueprintLibraryRestore,
	previewOpenFabUserBlueprintLibraryRestorePlan,
	serializeOpenFabUserBlueprintLibraryBundle,
	validateOpenFabUserBlueprintLibrarySnapshot,
} from "./OpenFabUserBlueprintLibraryBundle";

describe("OpenFabUserBlueprintLibraryBundle", () => {
	it("round-trips one deterministic, fingerprinted whole-library snapshot", () => {
		const bundle = createOpenFabUserBlueprintLibraryBundle(
			[
				createRecord("z-record", "Etch return", { folderPath: ["Etch"], quickSlot: 4 }),
				createRecord("a-record", "Photo bay", { folderPath: ["Photo"], quickSlot: 1 }),
			],
			"2026-08-03T00:00:00.000Z",
		);

		const json = serializeOpenFabUserBlueprintLibraryBundle(bundle);
		const parsed = parseOpenFabUserBlueprintLibraryBundleJson(json);

		expect(parsed).toEqual(bundle);
		expect(parsed.records.map(({ id }) => id)).toEqual(["a-record", "z-record"]);
		expect(parsed.recordCount).toBe(2);
		expect(parsed.aggregateEdgeCount).toBe(8);
		expect(parsed.fingerprint).toMatch(/^ofubl2-[0-9a-f]{8}:[0-9a-f]{8}$/);
		expect(serializeOpenFabUserBlueprintLibraryBundle(parsed)).toBe(json);
		expect(Object.isFrozen(parsed.records)).toBe(true);
	});

	it("uses runtime-independent code-unit ordering for portable fingerprints", () => {
		const records = [
			createRecord("a_b", "Underscore"),
			createRecord("a:b", "Colon"),
			createRecord("a.b", "Dot"),
		];
		const forward = createOpenFabUserBlueprintLibraryBundle(records, "2026-08-03T00:00:00.000Z");
		const reverse = createOpenFabUserBlueprintLibraryBundle(
			[...records].reverse(),
			"2026-08-03T00:00:00.000Z",
		);

		expect(forward.records.map(({ id }) => id)).toEqual(["a.b", "a:b", "a_b"]);
		expect(reverse.fingerprint).toBe(forward.fingerprint);
	});

	it("rejects tampered manifest fields, unknown fields, and record content", () => {
		const bundle = createOpenFabUserBlueprintLibraryBundle(
			[createRecord("record-a", "Bay A")],
			"2026-08-03T00:00:00.000Z",
		);
		const source = JSON.parse(serializeOpenFabUserBlueprintLibraryBundle(bundle)) as Record<
			string,
			unknown
		>;

		expectBundleError({ ...source, recordCount: 2 }, "$.recordCount");
		expectBundleError({ ...source, aggregateEdgeCount: 7 }, "$.aggregateEdgeCount");
		expectBundleError({ ...source, fingerprint: "ofubl1-tampered" }, "$.fingerprint");
		expectBundleError({ ...source, debug: true }, "$.debug");

		const records = structuredClone(source.records) as Array<Record<string, unknown>>;
		const blueprint = records[0]?.blueprint as Record<string, unknown>;
		blueprint.name = "Tampered";
		expectBundleError({ ...source, records }, "$.fingerprint");
	});

	it("validates whole-library id, folder/name, quick-slot, and aggregate constraints", () => {
		const first = createRecord("record-a", "Bay A", {
			folderPath: ["Photo"],
			quickSlot: 1,
		});
		expectSnapshotError([first, createRecord("record-a", "Bay B")], "duplicate record id");
		expectSnapshotError(
			[first, createRecord("record-b", "bay a", { folderPath: ["photo"], quickSlot: 2 })],
			"duplicate folder and name identity",
		);
		expectSnapshotError(
			[first, createRecord("record-b", "Bay B", { quickSlot: 1 })],
			"duplicate quick slot",
		);
	});

	it("preflights additive, exact duplicate, and compound conflicts without mutation", () => {
		const exact = createRecord("record-a", "Bay A", { quickSlot: 1 });
		const currentNameOwner = createRecord("record-current", "Existing", {
			folderPath: ["Photo"],
			quickSlot: 2,
		});
		const incomingIdConflict = updateOpenFabUserBlueprintRecord(
			updateRecordName(currentNameOwner, "Changed upstream"),
			{ quickSlot: 4, updatedAt: "2026-08-03T00:00:00.000Z" },
		);
		const incomingNameConflict = createRecord("record-name", "existing", {
			folderPath: ["photo"],
			quickSlot: 5,
		});
		const incomingSlotConflict = createRecord("record-slot", "Different", { quickSlot: 2 });
		const additive = createRecord("record-new", "New Bay", { quickSlot: 3 });
		const bundle = createOpenFabUserBlueprintLibraryBundle(
			[exact, incomingIdConflict, incomingNameConflict, incomingSlotConflict, additive],
			"2026-08-03T00:00:00.000Z",
		);

		const preflight = createOpenFabUserBlueprintLibraryRestorePreflight(bundle, [
			exact,
			currentNameOwner,
		]);

		expect(preflight.additiveRecords.map(({ id }) => id)).toEqual(["record-new"]);
		expect(preflight.duplicateRecords.map(({ id }) => id)).toEqual(["record-a"]);
		expect(preflight.conflicts.map(({ incomingRecord }) => incomingRecord.id)).toEqual([
			"record-current",
			"record-name",
			"record-slot",
		]);
		expect(preflight.conflicts.map(({ reasons }) => reasons.map(({ kind }) => kind))).toEqual([
			["id"],
			["folder-name"],
			["quick-slot"],
		]);
		expect(currentNameOwner.blueprint.name).toBe("Existing");
	});

	it("plans conservative merge decisions and conflict copies as one valid final snapshot", () => {
		const current = [
			createRecord("record-a", "Bay A", { quickSlot: 1 }),
			createRecord("record-current", "Existing", {
				folderPath: ["Photo"],
				quickSlot: 2,
			}),
		];
		const bundle = createOpenFabUserBlueprintLibraryBundle(
			[
				current[0] as ReturnType<typeof createRecord>,
				updateRecordName(current[1] as ReturnType<typeof createRecord>, "Incoming revision"),
				createRecord("record-name", "existing", {
					folderPath: ["photo"],
					quickSlot: 5,
				}),
				createRecord("record-new", "New Bay", { quickSlot: 3 }),
			],
			"2026-08-03T00:00:00.000Z",
		);
		const preflight = createOpenFabUserBlueprintLibraryRestorePreflight(bundle, current);
		const ids = ["record-new", "record-copy-a", "record-copy-b"];

		const plan = planOpenFabUserBlueprintLibraryRestore(
			preflight,
			"merge",
			new Map([
				["record-current", "import-copy" as const],
				["record-name", "import-copy" as const],
			]),
			{
				createId: () => ids.shift() ?? "record-copy-overflow",
				restoredAt: "2026-08-04T00:00:00.000Z",
			},
		);

		expect(plan.importedCount).toBe(3);
		expect(plan.importedAsCopyCount).toBe(2);
		expect(plan.retainedCount).toBe(2);
		expect(plan.skippedDuplicateCount).toBe(1);
		expect(plan.records).toHaveLength(5);
		expect(plan.records.find(({ id }) => id === "record-copy-a")).toMatchObject({
			quickSlot: null,
			blueprint: { name: "Incoming revision (Imported)" },
		});
		expect(plan.records.find(({ id }) => id === "record-copy-b")).toMatchObject({
			quickSlot: null,
			blueprint: { name: "existing (Imported)" },
		});
		expect(() => validateOpenFabUserBlueprintLibrarySnapshot(plan.records)).not.toThrow();
	});

	it("makes replace exactly match the validated backup and defaults merge conflicts to current", () => {
		const current = [createRecord("current", "Current", { quickSlot: 1 })];
		const incoming = createRecord("incoming", "Incoming", { quickSlot: 2 });
		const bundle = createOpenFabUserBlueprintLibraryBundle([incoming], "2026-08-03T00:00:00.000Z");
		const preflight = createOpenFabUserBlueprintLibraryRestorePreflight(bundle, current);
		const replace = planOpenFabUserBlueprintLibraryRestore(preflight, "replace", new Map(), {
			createId: () => "unused",
			restoredAt: "2026-08-04T00:00:00.000Z",
		});

		expect(replace.records).toEqual(bundle.records);
		expect(replace.retainedCount).toBe(0);
		const replaced = replace.records[0];
		if (!replaced) throw new Error("Expected a replacement blueprint.");
		expect(openFabUserBlueprintRecordsEqual(replaced, incoming)).toBe(true);
	});

	it("reports destructive replace impact and previews decision-sensitive merge capacity", () => {
		const unchanged = createRecord("unchanged", "Unchanged", { quickSlot: 1 });
		const currentChanged = createRecord("changed", "Old name", { quickSlot: 2 });
		const removed = createRecord("removed", "Removed", { quickSlot: 3 });
		const incomingChanged = updateRecordName(currentChanged, "New name");
		const added = createRecord("added", "Added", { quickSlot: 4 });
		const bundle = createOpenFabUserBlueprintLibraryBundle(
			[unchanged, incomingChanged, added],
			"2026-08-03T00:00:00.000Z",
		);
		const preflight = createOpenFabUserBlueprintLibraryRestorePreflight(bundle, [
			unchanged,
			currentChanged,
			removed,
		]);

		const impact = createOpenFabUserBlueprintLibraryReplaceImpact(preflight);
		expect(impact).toMatchObject({
			addedCount: 1,
			changedCount: 1,
			removedCount: 1,
			unchangedCount: 1,
		});
		expect(impact.entries.map(({ kind, recordId }) => [kind, recordId])).toEqual([
			["added", "added"],
			["changed", "changed"],
			["removed", "removed"],
		]);
		expect(impact.entries.find(({ recordId }) => recordId === "changed")).toMatchObject({
			edgeCount: 4,
			previousEdgeCount: 4,
			portCount: 0,
			previousPortCount: 0,
			quickSlot: 2,
			previousQuickSlot: 2,
		});

		const preview = previewOpenFabUserBlueprintLibraryRestorePlan(
			preflight,
			"merge",
			new Map([["changed", "import-copy"]]),
		);
		expect(preview).toMatchObject({
			valid: true,
			reason: null,
			recordCount: 5,
			aggregateEdgeCount: 20,
		});
		expect(preview.aggregateJsonBytes).toBeGreaterThan(0);
		const exactPlan = planOpenFabUserBlueprintLibraryRestore(
			preflight,
			"merge",
			new Map([["changed", "import-copy"]]),
			{
				createId: () => `i${"x".repeat(OPENFAB_USER_BLUEPRINT_RESTORE_GENERATED_ID_LENGTH - 1)}`,
				restoredAt: "9999-12-31T23:59:59.999Z",
			},
		);
		expect(preview.aggregateJsonBytes).toBe(
			exactPlan.records.reduce(
				(total, record) => total + openFabUserBlueprintRecordJsonByteLength(record),
				0,
			),
		);
	});
});

function expectBundleError(value: unknown, path: string): void {
	try {
		parseOpenFabUserBlueprintLibraryBundleJson(JSON.stringify(value));
		throw new Error(`Expected bundle error at ${path}`);
	} catch (error) {
		expect(error).toBeInstanceOf(OpenFabUserBlueprintParseError);
		expect(error).toMatchObject({ path });
	}
}

function expectSnapshotError(
	records: readonly ReturnType<typeof createRecord>[],
	message: string,
): void {
	expect(() => validateOpenFabUserBlueprintLibrarySnapshot(records)).toThrow(message);
}

function updateRecordName(record: ReturnType<typeof createRecord>, name: string) {
	const updatedAt = "2026-08-03T00:00:00.000Z";
	return updateOpenFabUserBlueprintRecord(record, {
		updatedAt,
		blueprint: updateOpenFabProjectBlueprint(record.blueprint, { name, updatedAt }),
	});
}

function createRecord(
	id: string,
	name: string,
	options: Readonly<{
		folderPath?: readonly string[];
		quickSlot?: number | null;
	}> = {},
) {
	return createOpenFabUserBlueprintRecord(
		createOpenFabRailAreaBlueprint(TEMPLATE, {
			id: `${id}-portable`,
			name,
			createdAt: "2026-08-02T00:00:00.000Z",
		}),
		{
			id,
			folderPath: options.folderPath,
			quickSlot: options.quickSlot,
			createdAt: "2026-08-02T00:00:00.000Z",
		},
	);
}

const TEMPLATE: RailAreaStampTemplate = Object.freeze({
	sourceRevision: 1,
	sourceModuleKeys: Object.freeze(["closed-loop"]),
	sourceModuleCount: 1,
	sourceEdgeCount: 4,
	sourceWidthMeters: 1,
	sourceHeightMeters: 1,
	edges: Object.freeze([
		Object.freeze({ from: Object.freeze({ x: 0, y: 0 }), to: Object.freeze({ x: 1, y: 0 }) }),
		Object.freeze({ from: Object.freeze({ x: 1, y: 0 }), to: Object.freeze({ x: 1, y: 1 }) }),
		Object.freeze({ from: Object.freeze({ x: 1, y: 1 }), to: Object.freeze({ x: 0, y: 1 }) }),
		Object.freeze({ from: Object.freeze({ x: 0, y: 1 }), to: Object.freeze({ x: 0, y: 0 }) }),
	]),
});
