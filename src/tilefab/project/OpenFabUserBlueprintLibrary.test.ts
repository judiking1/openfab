import { describe, expect, it } from "vitest";
import { createPortEquipmentMutationPlan } from "../core/PortEquipmentPlan";
import type { PortRecord } from "../core/PortRecord";
import { planRailConstruction } from "../core/paint";
import type { RailAreaStampTemplate } from "../core/RailAreaStamp";
import { RailDocument } from "../core/RailDocument";
import { buildRailModuleOwnershipIndex } from "../core/RailModuleOwnership";
import { DIR_E, DIR_W } from "../core/railShape";
import type { StaticFabBlueprintTemplate } from "../core/StaticFabBlueprint";
import {
	compareDirectedRailEdges,
	type StaticFabOrganizationState,
	staticFabOrganizationEdgeKey,
} from "../core/StaticFabOrganization";
import {
	captureStaticFabOrganizationBundle,
	type StaticFabOrganizationBundle,
} from "../core/StaticFabOrganizationBundle";
import {
	createOpenFabRailAreaBlueprint,
	createOpenFabStaticFabBlueprint,
	createOpenFabStaticFabOrganizationBlueprint,
} from "./OpenFabBlueprintLibrary";
import {
	compareOpenFabUserBlueprintRecords,
	copyOpenFabUserBlueprintRecord,
	createOpenFabUserBlueprintRecord,
	OPENFAB_USER_BLUEPRINT_MAX_JSON_BYTES,
	OpenFabUserBlueprintDiagnosticExportError,
	OpenFabUserBlueprintParseError,
	type OpenFabUserBlueprintRecord,
	openFabUserBlueprintsShareFolderAndName,
	openFabUtf8ByteLength,
	parseOpenFabUserBlueprintJson,
	parseOpenFabUserBlueprintRecord,
	serializeOpenFabUserBlueprintDiagnosticValue,
	serializeOpenFabUserBlueprintRecord,
	updateOpenFabUserBlueprintRecord,
} from "./OpenFabUserBlueprintLibrary";

describe("OpenFabUserBlueprintLibrary", () => {
	it("round-trips a deeply immutable portable blueprint envelope", () => {
		const source = createRecord("library-bay-a", "Bay A", {
			folderPath: ["Photo", "Production"],
			quickSlot: 3,
		});
		const parsed = parseOpenFabUserBlueprintRecord(JSON.parse(JSON.stringify(source)));

		expect(parsed).toEqual(source);
		expect(Object.isFrozen(parsed)).toBe(true);
		expect(Object.isFrozen(parsed.folderPath)).toBe(true);
		expect(Object.isFrozen(parsed.blueprint)).toBe(true);
		expect(Object.isFrozen(parsed.blueprint.edges)).toBe(true);
	});

	it("serializes one canonical portable .openfabbp envelope", () => {
		const source = createRecord("library-bay-a", "Bay A", {
			folderPath: ["Photo", "Production"],
			quickSlot: 3,
		});
		const reordered = Object.fromEntries(Object.entries(source).reverse());

		const json = serializeOpenFabUserBlueprintRecord(parseOpenFabUserBlueprintRecord(reordered));
		const parsed = parseOpenFabUserBlueprintJson(json);

		expect(parsed).toEqual(source);
		expect(json.endsWith("\n")).toBe(true);
		expect(json.indexOf('"blueprint"')).toBeLessThan(json.indexOf('"createdAt"'));
		expect(serializeOpenFabUserBlueprintRecord(parsed)).toBe(json);
	});

	it("rejects malformed and over-budget .openfabbp JSON before record admission", () => {
		expectUserBlueprintParseError(() => parseOpenFabUserBlueprintJson("{"), "INVALID_JSON");
		expectUserBlueprintParseError(
			() => parseOpenFabUserBlueprintJson(" ".repeat(OPENFAB_USER_BLUEPRINT_MAX_JSON_BYTES + 1)),
			"LIMIT_EXCEEDED",
		);
	});

	it("measures the portable file budget in UTF-8 bytes", () => {
		expect(openFabUtf8ByteLength("A가😀\ud800")).toBe(11);
		expectUserBlueprintParseError(
			() =>
				parseOpenFabUserBlueprintJson(
					"가".repeat(Math.floor(OPENFAB_USER_BLUEPRINT_MAX_JSON_BYTES / 3) + 1),
				),
			"LIMIT_EXCEEDED",
		);
	});

	it("serializes an exact JSON-compatible quarantined value without admitting it", () => {
		const source = Object.freeze({
			id: "corrupt",
			schemaVersion: 99,
			note: Object.freeze(["preserve", 7, true, null]),
		});

		expect(serializeOpenFabUserBlueprintDiagnosticValue(source)).toBe(
			`${JSON.stringify(source, null, "\t")}\n`,
		);
	});

	it.each([
		["undefined", (): unknown => undefined],
		["bigint", (): unknown => 1n],
		["negative zero", (): unknown => -0],
		["date", () => new Date("2026-08-03T00:00:00.000Z")],
		["sparse array", () => new Array(1)],
		[
			"extra array property",
			() => {
				const value: unknown[] & { extra?: string } = [];
				value.extra = "lost";
				return value;
			},
		],
		["accessor", () => Object.defineProperty({}, "value", { enumerable: true, get: () => 1 })],
		["symbol property", () => Object.assign({}, { [Symbol("lost")]: true })],
		[
			"shared reference",
			() => {
				const shared = { value: 1 };
				return { first: shared, second: shared };
			},
		],
		[
			"cycle",
			() => {
				const value: { self?: unknown } = {};
				value.self = value;
				return value;
			},
		],
	] as const)("rejects non-exact diagnostic JSON input: %s", (_label, createValue) => {
		expect(() => serializeOpenFabUserBlueprintDiagnosticValue(createValue())).toThrow(
			OpenFabUserBlueprintDiagnosticExportError,
		);
	});

	it("bounds diagnostic traversal depth before JSON serialization", () => {
		let value: Record<string, unknown> = {};
		const root = value;
		for (let depth = 0; depth < 66; depth += 1) {
			const child: Record<string, unknown> = {};
			value.child = child;
			value = child;
		}

		expect(() => serializeOpenFabUserBlueprintDiagnosticValue(root)).toThrow(
			expect.objectContaining({ code: "LIMIT_EXCEEDED" }),
		);
	});

	it("rejects aggregate diagnostic strings before allocating the complete JSON document", () => {
		const chunk = "x".repeat(9 * 1024 * 1024);

		expect(() =>
			serializeOpenFabUserBlueprintDiagnosticValue({ first: chunk, second: chunk }),
		).toThrow(expect.objectContaining({ code: "LIMIT_EXCEEDED" }));
	});

	it("defensively copies nested portable geometry", () => {
		const source = createRecord("library-bay-a", "Bay A");
		const copied = copyOpenFabUserBlueprintRecord(source);

		expect(copied).toEqual(source);
		expect(copied).not.toBe(source);
		expect(copied.folderPath).not.toBe(source.folderPath);
		expect(copied.blueprint).not.toBe(source.blueprint);
		expect(copied.blueprint.edges).not.toBe(source.blueprint.edges);
	});

	it.each([
		"copy",
		"parse",
	] as const)("%s defensively deep-copies STATIC_FAB ports and equipment groups", (path) => {
		const source = structuredClone(createStaticFabRecord());
		const copied = copyOrParseUserBlueprint(path, source);

		expect(copied).toEqual(source);
		expect(copied).not.toBe(source);
		expect(copied.blueprint).not.toBe(source.blueprint);
		if (source.blueprint.kind !== "STATIC_FAB" || copied.blueprint.kind !== "STATIC_FAB") {
			throw new Error("Expected a STATIC_FAB user blueprint fixture.");
		}
		expect(copied.blueprint.ports).not.toBe(source.blueprint.ports);
		for (let index = 0; index < source.blueprint.ports.length; index += 1) {
			const sourcePort = source.blueprint.ports[index];
			const copiedPort = copied.blueprint.ports[index];
			expect(copiedPort).not.toBe(sourcePort);
			expect(copiedPort?.route).not.toBe(sourcePort?.route);
			expect(copiedPort?.route.cell).not.toBe(sourcePort?.route.cell);
		}
		expect(copied.blueprint.equipmentGroups).not.toBe(source.blueprint.equipmentGroups);
		for (let index = 0; index < source.blueprint.equipmentGroups.length; index += 1) {
			const sourceGroup = source.blueprint.equipmentGroups[index];
			const copiedGroup = copied.blueprint.equipmentGroups[index];
			expect(copiedGroup).not.toBe(sourceGroup);
			expect(copiedGroup?.portIndices).not.toBe(sourceGroup?.portIndices);
		}
	});

	it.each([
		"copy",
		"parse",
	] as const)("%s defensively deep-copies STATIC_FAB_ORGANIZATION authored truth", (path) => {
		const source = structuredClone(createOrganizationRecord());
		const copied = copyOrParseUserBlueprint(path, source);

		expect(copied).toEqual(source);
		expect(copied).not.toBe(source);
		expect(copied.blueprint).not.toBe(source.blueprint);
		if (
			source.blueprint.kind !== "STATIC_FAB_ORGANIZATION" ||
			copied.blueprint.kind !== "STATIC_FAB_ORGANIZATION"
		) {
			throw new Error("Expected a STATIC_FAB_ORGANIZATION user blueprint fixture.");
		}
		const sourceBundle = source.blueprint.bundle;
		const copiedBundle = copied.blueprint.bundle;
		expect(copiedBundle).not.toBe(sourceBundle);
		expect(copiedBundle.rootOrganizationIndices).not.toBe(sourceBundle.rootOrganizationIndices);
		expect(copiedBundle.ports).not.toBe(sourceBundle.ports);
		for (let index = 0; index < sourceBundle.ports.length; index += 1) {
			expect(copiedBundle.ports[index]).not.toBe(sourceBundle.ports[index]);
			expect(copiedBundle.ports[index]?.route).not.toBe(sourceBundle.ports[index]?.route);
		}
		expect(copiedBundle.equipmentGroups).not.toBe(sourceBundle.equipmentGroups);
		for (let index = 0; index < sourceBundle.equipmentGroups.length; index += 1) {
			const sourceGroup = sourceBundle.equipmentGroups[index];
			const copiedGroup = copiedBundle.equipmentGroups[index];
			expect(copiedGroup).not.toBe(sourceGroup);
			expect(copiedGroup?.portIndices).not.toBe(sourceGroup?.portIndices);
		}
		expect(copiedBundle.organizations).not.toBe(sourceBundle.organizations);
		for (let index = 0; index < sourceBundle.organizations.length; index += 1) {
			const sourceOrganization = sourceBundle.organizations[index];
			const copiedOrganization = copiedBundle.organizations[index];
			expect(copiedOrganization).not.toBe(sourceOrganization);
			expect(copiedOrganization?.parentOrganizationIndices).not.toBe(
				sourceOrganization?.parentOrganizationIndices,
			);
			expect(copiedOrganization?.properties).not.toBe(sourceOrganization?.properties);
			expect(copiedOrganization?.membership).not.toBe(sourceOrganization?.membership);
			expect(copiedOrganization?.membership.railEdgeIndices).not.toBe(
				sourceOrganization?.membership.railEdgeIndices,
			);
			expect(copiedOrganization?.membership.advancedSwitchIndices).not.toBe(
				sourceOrganization?.membership.advancedSwitchIndices,
			);
			expect(copiedOrganization?.membership.equipmentGroupIndices).not.toBe(
				sourceOrganization?.membership.equipmentGroupIndices,
			);
		}
	});

	it("updates user scope without changing the embedded project blueprint identity", () => {
		const source = createRecord("library-bay-a", "Bay A");
		const updated = updateOpenFabUserBlueprintRecord(source, {
			folderPath: ["Etch"],
			quickSlot: 7,
			updatedAt: "2026-08-02T01:00:00.000Z",
		});

		expect(updated).toMatchObject({ folderPath: ["Etch"], quickSlot: 7 });
		expect(updated.blueprint).toEqual(source.blueprint);
	});

	it.each([
		["unknown field", { extra: true }],
		["deep folder", { folderPath: ["a", "b", "c", "d", "e"] }],
		["unnormalized folder", { folderPath: [" Photo"] }],
		["reserved folder", { folderPath: [".."] }],
		["invalid quick slot", { quickSlot: 10 }],
		["invalid time", { updatedAt: "not-a-time" }],
	])("rejects %s", (_label, changes) => {
		const source = createRecord("library-bay-a", "Bay A");
		expect(() => parseOpenFabUserBlueprintRecord({ ...source, ...changes })).toThrow();
	});

	it("reuses the native blueprint validator for embedded geometry", () => {
		const source = createRecord("library-bay-a", "Bay A");
		expect(() =>
			parseOpenFabUserBlueprintRecord({
				...source,
				blueprint: { ...source.blueprint, edges: [] },
			}),
		).toThrow("blueprint must contain");
	});

	it("sorts favorite and quick-slot records before folder, name, and update time", () => {
		const records = [
			createRecord("plain-z", "Zulu", { folderPath: ["B"] }),
			createRecord("slot-2", "Slot two", { quickSlot: 2 }),
			createRecord("favorite", "Favorite", { favorite: true }),
			createRecord("slot-1", "Slot one", { quickSlot: 1 }),
		];

		expect(records.sort(compareOpenFabUserBlueprintRecords).map(({ id }) => id)).toEqual([
			"favorite",
			"slot-1",
			"slot-2",
			"plain-z",
		]);
	});

	it("compares the portable folder and name identity case-insensitively", () => {
		const source = createRecord("source", "Photo Bay", { folderPath: ["Process", "Photo"] });
		const sameIdentity = createRecord("same", "PHOTO BAY", {
			folderPath: ["process", "photo"],
		});
		const otherFolder = createRecord("other", "Photo Bay", {
			folderPath: ["Process", "Etch"],
		});

		expect(openFabUserBlueprintsShareFolderAndName(source, sameIdentity)).toBe(true);
		expect(openFabUserBlueprintsShareFolderAndName(source, otherFolder)).toBe(false);
	});
});

function expectUserBlueprintParseError(
	action: () => unknown,
	code: OpenFabUserBlueprintParseError["code"],
): void {
	try {
		action();
		throw new Error(`Expected ${code}`);
	} catch (error) {
		expect(error).toBeInstanceOf(OpenFabUserBlueprintParseError);
		expect(error).toMatchObject({ code, path: "$" });
	}
}

function createRecord(
	id: string,
	name: string,
	options: Readonly<{
		folderPath?: readonly string[];
		quickSlot?: number | null;
		favorite?: boolean;
	}> = {},
) {
	const blueprint = createOpenFabRailAreaBlueprint(TEMPLATE, {
		id: `${id}-portable`,
		name,
		favorite: options.favorite,
		createdAt: "2026-08-02T00:00:00.000Z",
	});
	return createOpenFabUserBlueprintRecord(blueprint, {
		id,
		folderPath: options.folderPath,
		quickSlot: options.quickSlot,
		createdAt: "2026-08-02T00:00:00.000Z",
	});
}

function copyOrParseUserBlueprint(
	path: "copy" | "parse",
	source: OpenFabUserBlueprintRecord,
): OpenFabUserBlueprintRecord {
	return path === "copy"
		? copyOpenFabUserBlueprintRecord(source)
		: parseOpenFabUserBlueprintRecord(source);
}

function createStaticFabRecord(): OpenFabUserBlueprintRecord {
	const blueprint = createOpenFabStaticFabBlueprint(STATIC_FAB_TEMPLATE, {
		id: "static-fab-portable",
		name: "Portable static FAB",
		createdAt: "2026-08-02T00:00:00.000Z",
	});
	return createOpenFabUserBlueprintRecord(blueprint, {
		id: "library-static-fab",
		createdAt: "2026-08-02T00:00:00.000Z",
	});
}

function createOrganizationRecord(): OpenFabUserBlueprintRecord {
	const blueprint = createOpenFabStaticFabOrganizationBlueprint(organizationBundleFixture(), {
		id: "static-fab-organization-portable",
		name: "Portable organization FAB",
		createdAt: "2026-08-02T00:00:00.000Z",
	});
	return createOpenFabUserBlueprintRecord(blueprint, {
		id: "library-static-fab-organization",
		createdAt: "2026-08-02T00:00:00.000Z",
	});
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

const STATIC_FAB_TEMPLATE: StaticFabBlueprintTemplate = Object.freeze({
	rail: Object.freeze({
		sourceRevision: 1,
		sourceModuleKeys: Object.freeze(["portable-static-fab"]),
		sourceModuleCount: 20,
		sourceEdgeCount: 20,
		sourceWidthMeters: 6,
		sourceHeightMeters: 4,
		edges: Object.freeze(rectangleEdges(6, 4)),
	}),
	ports: Object.freeze([
		staticFabPort(0, 1, 0, DIR_W, DIR_E, "LEFT", 400, "WITH_TRAVEL", "OHB"),
		staticFabPort(1, 2, 0, DIR_W, DIR_E, "CENTER", 0, "WITH_TRAVEL", "EQ"),
		staticFabPort(1, 3, 0, DIR_W, DIR_E, "CENTER", 0, "WITH_TRAVEL", "EQ"),
		staticFabPort(2, 5, 4, DIR_E, DIR_W, "CENTER", 0, "WITH_TRAVEL", "STK"),
		staticFabPort(2, 4, 4, DIR_E, DIR_W, "CENTER", 0, "WITH_TRAVEL", "STK"),
		staticFabPort(2, 3, 4, DIR_E, DIR_W, "CENTER", 0, "WITH_TRAVEL", "STK"),
		staticFabPort(2, 2, 4, DIR_E, DIR_W, "CENTER", 0, "WITH_TRAVEL", "STK"),
	]),
	equipmentGroups: Object.freeze([
		Object.freeze({
			kind: "OHB" as const,
			template: "SINGLE" as const,
			portIndices: Object.freeze([0]),
		}),
		Object.freeze({
			kind: "EQ" as const,
			pitchMillimeters: 1_000,
			recipe: "PHOTO",
			portIndices: Object.freeze([1, 2]),
		}),
		Object.freeze({
			kind: "STK" as const,
			template: "FOUR_PORT" as const,
			portIndices: Object.freeze([3, 4, 5, 6]),
		}),
	]),
});

function staticFabPort(
	equipmentGroupIndex: number,
	x: number,
	z: number,
	from: 1 | 2 | 4 | 8,
	to: 1 | 2 | 4 | 8,
	side: "CENTER" | "LEFT" | "RIGHT",
	lateralOffsetMillimeters: number,
	direction: "WITH_TRAVEL" | "AGAINST_TRAVEL",
	portType: "OHB" | "EQ" | "STK",
) {
	return Object.freeze({
		equipmentGroupIndex,
		route: Object.freeze({ kind: "CARDINAL_CELL" as const, x, z, from, to }),
		stationMillimeters: 500,
		side,
		lateralOffsetMillimeters,
		direction,
		portType,
	});
}

function rectangleEdges(width: number, height: number) {
	const edges: Array<{
		readonly from: { readonly x: number; readonly y: number };
		readonly to: { readonly x: number; readonly y: number };
	}> = [];
	for (let x = 0; x < width; x += 1) edges.push(edge(x, 0, x + 1, 0));
	for (let y = 0; y < height; y += 1) edges.push(edge(width, y, width, y + 1));
	for (let x = width; x > 0; x -= 1) edges.push(edge(x, height, x - 1, height));
	for (let y = height; y > 0; y -= 1) edges.push(edge(0, y, 0, y - 1));
	return edges;
}

function edge(fromX: number, fromY: number, toX: number, toY: number) {
	return Object.freeze({
		from: Object.freeze({ x: fromX, y: fromY }),
		to: Object.freeze({ x: toX, y: toY }),
	});
}

function organizationBundleFixture(): StaticFabOrganizationBundle {
	const document = new RailDocument();
	const rail = planRailConstruction(document.map, { x: 0, y: 0 }, { x: 5, y: 0 });
	if (!rail.valid || !document.commit(rail)) {
		throw new Error(`Organization fixture rail failed: ${rail.reason}`);
	}
	if (!document.commitPortEquipment(organizationOhbPlan(document))) {
		throw new Error("Organization fixture OHB failed.");
	}
	const edgeByKey = new Map(
		buildRailModuleOwnershipIndex(document.map).modules.flatMap((module) =>
			module.eraseEdges.map(
				(railEdge) => [staticFabOrganizationEdgeKey(railEdge), railEdge] as const,
			),
		),
	);
	const railEdges = Object.freeze([...edgeByKey.values()].sort(compareDirectedRailEdges));
	const organizations: StaticFabOrganizationState = Object.freeze({
		nextOrganizationId: 3,
		records: Object.freeze([
			Object.freeze({
				id: 1,
				kind: "AREA" as const,
				name: "Portable Area",
				parentOrganizationIds: Object.freeze([]),
				properties: Object.freeze({ description: "Reusable area", color: "CYAN" as const }),
				membership: Object.freeze({
					railEdges,
					advancedSwitchIds: Object.freeze([]),
					equipmentGroupIds: Object.freeze([1]),
				}),
			}),
			Object.freeze({
				id: 2,
				kind: "BAY" as const,
				name: "Portable Bay",
				parentOrganizationIds: Object.freeze([1]),
				properties: Object.freeze({ description: "Reusable bay", color: "AMBER" as const }),
				membership: Object.freeze({
					railEdges,
					advancedSwitchIds: Object.freeze([]),
					equipmentGroupIds: Object.freeze([1]),
				}),
			}),
		]),
	});
	const captured = captureStaticFabOrganizationBundle(
		document.map,
		document.portEquipment,
		document.getPatchSequence(),
		organizations,
		[1],
		"EFFECTIVE",
	);
	if (!captured.valid) {
		throw new Error(`Organization fixture capture failed: ${captured.reason}`);
	}
	return captured.bundle;
}

function organizationOhbPlan(document: RailDocument) {
	const port: PortRecord = {
		id: 1,
		equipmentGroupId: 1,
		route: { kind: "CARDINAL_CELL", x: 1, z: 0, from: DIR_W, to: DIR_E },
		stationMillimeters: 500,
		side: "LEFT",
		lateralOffsetMillimeters: 700,
		direction: "WITH_TRAVEL",
		portType: "OHB",
		barcode: "OHB-001",
	};
	const group = { id: 1, kind: "OHB" as const, template: "SINGLE" as const, portIds: [1] };
	return createPortEquipmentMutationPlan(
		"place-ohb",
		document.map.getRevision(),
		document.getPatchSequence(),
		[{ id: 1, before: null, after: port }],
		[{ id: 1, before: null, after: group }],
	);
}
