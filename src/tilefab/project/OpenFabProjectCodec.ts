import {
	ADVANCED_SWITCH_ALL_MOVEMENTS,
	ADVANCED_SWITCH_MAX_ID,
	ADVANCED_SWITCH_PROFILE_CLASSES,
	type AdvancedSwitchProfileClass,
	advancedSwitchRecordError,
	deriveAdvancedSwitchGeometry,
	validateAdvancedSwitchTopology,
} from "../core/AdvancedSwitch";
import {
	EQUIPMENT_GROUP_KINDS,
	type EquipmentGroupRecord,
	equipmentGroupError,
	portEquipmentStateError,
	STK_AUTHORING_TEMPLATES,
	STK_EQUIPMENT_TEMPLATES,
} from "../core/EquipmentGroup";
import {
	copyOperationalConfigurationState,
	emptyOperationalConfigurationState,
	OPERATIONAL_CONFIGURATION_LEGACY_SCHEMA_VERSION,
	OPERATIONAL_CONFIGURATION_SCHEMA_VERSION,
	OPERATIONAL_RESIDENT_HOME_SLOT_LIMIT,
	OPERATIONAL_RESIDENT_HOME_SLOT_POLICY,
	OPERATIONAL_STATION_TRANSFER_CAPABILITIES,
	type OperationalConfigurationReview,
	type OperationalConfigurationState,
	type OperationalEqGroupQualificationRecord,
	type OperationalEqPortQualificationOverrideRecord,
	type OperationalLogicalDefinition,
	type OperationalResidentHomeSlotRecord,
	type OperationalStationCapabilityRecord,
	type OperationalStorageGroupConfigurationRecord,
	type OperationalStoragePolicyDefinition,
	type OperationalVehicleReservationProfile,
	reviewOperationalConfiguration,
} from "../core/OperationalConfiguration";
import { OrderedTypedChecksum } from "../core/OrderedTypedChecksum";
import { assertPortEquipmentLayout } from "../core/PortEquipmentLayoutValidator";
import {
	ADVANCED_SWITCH_ROUTE_ROLES,
	PORT_DIRECTIONS,
	PORT_SIDES,
	PORT_TYPES,
	type PortDirection,
	type PortSide,
	type PortType,
	portRecordError,
} from "../core/PortRecord";
import { classifyRailCell } from "../core/RailCellClassification";
import { ALL_DIRECTIONS, bitCount, moveCell, oppositeDirection } from "../core/railShape";
import {
	createStaticFabAssemblyRelationshipState,
	emptyStaticFabAssemblyRelationshipState,
	staticFabAssemblyRelationshipStateSourceError,
} from "../core/StaticFabAssemblyRelationship";
import { staticFabPortSpacingConflict } from "../core/StaticFabBlueprint";
import {
	STATIC_FAB_ORGANIZATION_COLORS,
	STATIC_FAB_ORGANIZATION_KINDS,
	STATIC_FAB_ORGANIZATION_MAX_DESCRIPTION_LENGTH,
	STATIC_FAB_ORGANIZATION_MAX_PARENTS,
	type StaticFabOrganizationState,
	staticFabOrganizationStateError,
} from "../core/StaticFabOrganization";
import {
	prepareStaticFabOrganizationBundle,
	type StaticFabOrganizationBundle,
} from "../core/StaticFabOrganizationBundle";
import { analyzeStkPortLayout } from "../core/StkPortLayout";
import { decodeRailCell, encodeRailCell, TileMap } from "../core/TileMap";
import {
	compareOpenFabBlueprintEdgeTuples,
	createEmptyOpenFabProjectBlueprintSection,
	OPENFAB_BLUEPRINT_KIND_RAIL_AREA,
	OPENFAB_BLUEPRINT_KIND_STATIC_FAB,
	OPENFAB_BLUEPRINT_KIND_STATIC_FAB_ORGANIZATION,
	OPENFAB_BLUEPRINT_MAX_EDGES_PER_RECORD,
	OPENFAB_BLUEPRINT_MAX_RECORDS,
	OPENFAB_BLUEPRINT_MAX_TOTAL_EDGES,
	OPENFAB_BLUEPRINT_SECTION_SCHEMA_VERSION,
	type OpenFabBlueprintEdgeTuple,
	type OpenFabProjectBlueprint,
	type OpenFabProjectBlueprintSection,
	type OpenFabStaticFabBlueprint,
	type OpenFabStaticFabBlueprintEquipmentGroup,
	type OpenFabStaticFabBlueprintPort,
	type OpenFabStaticFabOrganizationBlueprint,
	STATIC_FAB_BLUEPRINT_MAX_EQUIPMENT_GROUPS,
	STATIC_FAB_BLUEPRINT_MAX_PORTS,
} from "./OpenFabBlueprintLibrary";
import {
	OPENFAB_EQUIPMENT_SECTION_SCHEMA_VERSION,
	OPENFAB_PORT_SECTION_SCHEMA_VERSION,
	OPENFAB_PROJECT_DIRECTION_NAMES,
	OPENFAB_PROJECT_KIND,
	OPENFAB_PROJECT_SCHEMA_VERSION,
	OPENFAB_PROJECT_VIEW_MAX_ZOOM_PIXELS_PER_METER,
	OPENFAB_PROJECT_VIEW_MIN_ZOOM_PIXELS_PER_METER,
	OPENFAB_RAIL_CELL_ENCODING,
	OPENFAB_RAIL_CELL_SIZE_MILLIMETERS,
	OPENFAB_RAIL_GRAMMAR,
	OPENFAB_RESERVED_SECTION_SCHEMA_VERSION,
	type OpenFabProject,
	type OpenFabProjectAdvancedSwitch,
	type OpenFabProjectDirection,
	type OpenFabProjectEquipmentGroup,
	type OpenFabProjectEquipmentSection,
	type OpenFabProjectManifest,
	type OpenFabProjectPort,
	type OpenFabProjectPortRoute,
	type OpenFabProjectPortSection,
	type OpenFabProjectQuarterTurns,
	type OpenFabProjectRailPresentation,
	type OpenFabProjectReservedSection,
	type OpenFabProjectView,
	type OpenFabRailCellTuple,
	openFabAdvancedSwitchToRecord,
	openFabProjectPortToRecord,
} from "./OpenFabProject";
import {
	createEmptyOpenFabProjectOrganizationSection,
	createStaticFabOrganizationStateFromOpenFabProjectSection,
	OPENFAB_ORGANIZATION_SECTION_SCHEMA_VERSION,
	OPENFAB_PROJECT_MAX_ORGANIZATION_EDGES,
	OPENFAB_PROJECT_MAX_ORGANIZATIONS,
	type OpenFabOrganizationRailEdgeTuple,
	type OpenFabProjectOrganizationRecord,
	type OpenFabProjectOrganizationSection,
} from "./OpenFabProjectOrganizations";
import {
	createEmptyOpenFabProjectRelationshipSection,
	OPENFAB_RELATIONSHIP_SECTION_SCHEMA_VERSION,
	type OpenFabProjectRelationshipSection,
} from "./OpenFabProjectRelationships";

type LegacyOperationalConfigurationStateV1 = Omit<
	OperationalConfigurationState,
	"schemaVersion" | "nextResidentHomeSlotId" | "residentHomeSlots"
> & {
	readonly schemaVersion: typeof OPERATIONAL_CONFIGURATION_LEGACY_SCHEMA_VERSION;
};

type OpenFabProjectVersionTen = Omit<OpenFabProject, "schemaVersion" | "relationships"> & {
	readonly schemaVersion: 10;
};

type OpenFabProjectAuthoredSource = OpenFabProject | OpenFabProjectVersionTen;

export const OPENFAB_PROJECT_MAX_JSON_CHARACTERS = 128 * 1024 * 1024;
export const OPENFAB_PROJECT_MAX_RAIL_CELLS = 1_000_000;
export const OPENFAB_PROJECT_MAX_ADVANCED_SWITCHES = 100_000;
export const OPENFAB_PROJECT_MAX_PORTS = 1_000_000;
export const OPENFAB_PROJECT_MAX_EQUIPMENT_GROUPS = 500_000;
export const OPENFAB_PROJECT_MAX_OPERATIONAL_DEFINITIONS = 100_000;

export type OpenFabProjectParseErrorCode =
	| "INVALID_JSON"
	| "INVALID_ROOT"
	| "UNSUPPORTED_KIND"
	| "UNSUPPORTED_VERSION"
	| "INVALID_FIELD"
	| "LIMIT_EXCEEDED"
	| "DUPLICATE_VALUE"
	| "INVALID_RAIL"
	| "INVALID_PORT_EQUIPMENT"
	| "INVALID_ORGANIZATION"
	| "INVALID_RELATIONSHIP";

export class OpenFabProjectParseError extends Error {
	readonly code: OpenFabProjectParseErrorCode;
	readonly path: string;

	constructor(code: OpenFabProjectParseErrorCode, path: string, message: string) {
		super(`${path}: ${message}`);
		this.name = "OpenFabProjectParseError";
		this.code = code;
		this.path = path;
	}
}

export interface OpenFabProjectParseResult {
	readonly project: OpenFabProject;
	readonly migratedFromVersion: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | null;
}

export function parseOpenFabProjectJson(source: string): OpenFabProjectParseResult {
	if (source.length > OPENFAB_PROJECT_MAX_JSON_CHARACTERS) {
		fail("LIMIT_EXCEEDED", "$", "project JSON exceeds the 128 MiB parsing limit");
	}
	let value: unknown;
	try {
		value = JSON.parse(source) as unknown;
	} catch (error) {
		const detail = error instanceof Error ? error.message : "invalid JSON";
		throw new OpenFabProjectParseError("INVALID_JSON", "$", detail);
	}
	return parseOpenFabProjectValue(value);
}

export function parseOpenFabProjectValue(value: unknown): OpenFabProjectParseResult {
	const root = expectRecord(value, "$", "INVALID_ROOT");
	const kind = expectString(root.kind, "$.kind");
	if (kind !== OPENFAB_PROJECT_KIND) {
		fail("UNSUPPORTED_KIND", "$.kind", `expected ${OPENFAB_PROJECT_KIND}`);
	}
	const schemaVersion = expectInteger(root.schemaVersion, "$.schemaVersion");
	if (schemaVersion === OPENFAB_PROJECT_SCHEMA_VERSION) {
		return Object.freeze({ project: validateVersionTwelve(root), migratedFromVersion: null });
	}
	if (schemaVersion === 11) {
		return Object.freeze({
			project: validateVersionTwelve({
				...root,
				schemaVersion: OPENFAB_PROJECT_SCHEMA_VERSION,
				blueprints: migrateBlueprintSectionV3(root.blueprints),
			}),
			migratedFromVersion: 11,
		});
	}
	if (schemaVersion === 10) {
		return Object.freeze({
			project: migrateVersionTen(validateVersionTen(root)),
			migratedFromVersion: 10,
		});
	}
	if (schemaVersion === 9) {
		return Object.freeze({
			project: migrateVersionTen(migrateVersionNine(root)),
			migratedFromVersion: 9,
		});
	}
	if (schemaVersion === 8) {
		return Object.freeze({
			project: migrateVersionTen(migrateVersionEight(root)),
			migratedFromVersion: 8,
		});
	}
	if (schemaVersion === 7) {
		return Object.freeze({
			project: migrateVersionTen(migrateVersionSeven(root)),
			migratedFromVersion: 7,
		});
	}
	if (schemaVersion === 6) {
		return Object.freeze({
			project: migrateVersionTen(migrateVersionSix(root)),
			migratedFromVersion: 6,
		});
	}
	if (schemaVersion === 5) {
		return Object.freeze({
			project: migrateVersionTen(migrateVersionFive(root)),
			migratedFromVersion: 5,
		});
	}
	if (schemaVersion === 4) {
		return Object.freeze({
			project: migrateVersionTen(migrateVersionFour(root)),
			migratedFromVersion: 4,
		});
	}
	if (schemaVersion === 3) {
		return Object.freeze({
			project: migrateVersionTen(migrateVersionThree(root)),
			migratedFromVersion: 3,
		});
	}
	if (schemaVersion === 2) {
		return Object.freeze({
			project: migrateVersionTen(migrateVersionTwo(root)),
			migratedFromVersion: 2,
		});
	}
	if (schemaVersion === 1) {
		return Object.freeze({
			project: migrateVersionTen(migrateVersionOne(root)),
			migratedFromVersion: 1,
		});
	}
	if (schemaVersion === 0) {
		return Object.freeze({
			project: migrateVersionTen(migrateVersionZero(root)),
			migratedFromVersion: 0,
		});
	}
	fail("UNSUPPORTED_VERSION", "$.schemaVersion", `unsupported schema version ${schemaVersion}`);
}

export function serializeOpenFabProject(
	project: OpenFabProject,
	maximumCharacters = OPENFAB_PROJECT_MAX_JSON_CHARACTERS,
): string {
	if (
		!Number.isSafeInteger(maximumCharacters) ||
		maximumCharacters <= 0 ||
		maximumCharacters > OPENFAB_PROJECT_MAX_JSON_CHARACTERS
	) {
		throw new Error("OpenFab project serialization limit is invalid.");
	}
	const normalized = validateVersionTwelve(expectRecord(project, "$", "INVALID_ROOT"));
	const sorted = sortJsonObjectKeys(normalized);
	const characterLength = prettyJsonCharacterLength(sorted) + 1;
	if (characterLength > maximumCharacters) {
		fail(
			"LIMIT_EXCEEDED",
			"$",
			`project JSON exceeds the ${maximumCharacters}-character serialization limit`,
		);
	}
	const serialized = `${JSON.stringify(sorted, null, "\t")}\n`;
	if (serialized.length !== characterLength) {
		throw new Error("OpenFab project serialization size preflight diverged.");
	}
	return serialized;
}

function prettyJsonCharacterLength(value: unknown, depth = 0): number {
	if (value === null || typeof value === "boolean" || typeof value === "number") {
		return JSON.stringify(value).length;
	}
	if (typeof value === "string") return JSON.stringify(value).length;
	if (Array.isArray(value)) {
		if (value.length === 0) return 2;
		let length = 3 + depth;
		for (let index = 0; index < value.length; index++) {
			length += depth + 1 + prettyJsonCharacterLength(value[index], depth + 1) + 1;
			if (index + 1 < value.length) length++;
		}
		return length;
	}
	if (typeof value === "object") {
		const entries = Object.entries(value);
		if (entries.length === 0) return 2;
		let length = 3 + depth;
		for (let index = 0; index < entries.length; index++) {
			const [key, nested] = entries[index] as [string, unknown];
			length +=
				depth +
				1 +
				JSON.stringify(key).length +
				2 +
				prettyJsonCharacterLength(nested, depth + 1) +
				1;
			if (index + 1 < entries.length) length++;
		}
		return length;
	}
	throw new Error("OpenFab project contains a non-JSON value after validation.");
}

/**
 * Validates one portable blueprint with the same strict grammar used by native project loading.
 * Cross-project stores and file codecs use this boundary instead of maintaining a second parser.
 */
export function parseOpenFabProjectBlueprintValue(value: unknown): OpenFabProjectBlueprint {
	const section = validateBlueprintSectionV4({
		schemaVersion: OPENFAB_BLUEPRINT_SECTION_SCHEMA_VERSION,
		records: [value],
	});
	const record = section.records[0];
	if (!record) {
		fail("INVALID_FIELD", "$.blueprints.records", "one blueprint record is required");
	}
	return record;
}

function validateVersionTwelve(root: Readonly<Record<string, unknown>>): OpenFabProject {
	expectExactKeys(
		root,
		[
			"kind",
			"schemaVersion",
			"manifest",
			"rail",
			"ports",
			"equipment",
			"operations",
			"blueprints",
			"areas",
			"relationships",
			"scenarios",
			"view",
		],
		"$",
	);
	expectLiteral(root.kind, OPENFAB_PROJECT_KIND, "$.kind");
	expectLiteral(root.schemaVersion, OPENFAB_PROJECT_SCHEMA_VERSION, "$.schemaVersion");
	const manifest = validateOpenFabProjectManifest(root.manifest);
	const rail = validateRailSection(root.rail);
	const ports = validatePortSection(root.ports);
	const equipment = validateEquipmentSection(root.equipment);
	const project = Object.freeze({
		kind: OPENFAB_PROJECT_KIND,
		schemaVersion: OPENFAB_PROJECT_SCHEMA_VERSION,
		manifest,
		rail,
		ports,
		equipment,
		operations: validateOperationalConfigurationSection(root.operations),
		blueprints: validateBlueprintSectionV4(root.blueprints),
		areas: validateOrganizationSection(root.areas),
		relationships: validateRelationshipSection(root.relationships),
		scenarios: validateReservedSection(root.scenarios, "$.scenarios"),
		view: root.view === null ? null : validateView(root.view),
	}) satisfies OpenFabProject;
	validateAuthoredRail(project);
	validatePortEquipment(project);
	const source = validateOrganizations(project);
	validateRelationships(project, source.map, source.organizations);
	return project;
}

function migrateVersionTen(project: OpenFabProjectVersionTen): OpenFabProject {
	return validateVersionTwelve({
		...project,
		schemaVersion: OPENFAB_PROJECT_SCHEMA_VERSION,
		relationships: createEmptyOpenFabProjectRelationshipSection(),
	});
}

function validateVersionTen(root: Readonly<Record<string, unknown>>): OpenFabProjectVersionTen {
	return validateNormalizedVersionTen({
		...root,
		blueprints: migrateBlueprintSectionV3(root.blueprints),
	});
}

function validateNormalizedVersionTen(
	root: Readonly<Record<string, unknown>>,
): OpenFabProjectVersionTen {
	expectExactKeys(
		root,
		[
			"kind",
			"schemaVersion",
			"manifest",
			"rail",
			"ports",
			"equipment",
			"operations",
			"blueprints",
			"areas",
			"scenarios",
			"view",
		],
		"$ v10",
	);
	expectLiteral(root.kind, OPENFAB_PROJECT_KIND, "$.kind");
	expectLiteral(root.schemaVersion, 10, "$.schemaVersion");
	const project = Object.freeze({
		kind: OPENFAB_PROJECT_KIND,
		schemaVersion: 10 as const,
		manifest: validateOpenFabProjectManifest(root.manifest),
		rail: validateRailSection(root.rail),
		ports: validatePortSection(root.ports),
		equipment: validateEquipmentSection(root.equipment),
		operations: validateOperationalConfigurationSection(root.operations),
		blueprints: validateBlueprintSectionV4(root.blueprints),
		areas: validateOrganizationSection(root.areas),
		scenarios: validateReservedSection(root.scenarios, "$.scenarios"),
		view: root.view === null ? null : validateView(root.view),
	}) satisfies OpenFabProjectVersionTen;
	validateAuthoredRail(project);
	validatePortEquipment(project);
	validateOrganizations(project);
	return project;
}

function migrateVersionNine(root: Readonly<Record<string, unknown>>): OpenFabProjectVersionTen {
	expectExactKeys(
		root,
		[
			"kind",
			"schemaVersion",
			"manifest",
			"rail",
			"ports",
			"equipment",
			"operations",
			"blueprints",
			"areas",
			"scenarios",
			"view",
		],
		"$ v9",
	);
	expectLiteral(root.schemaVersion, 9, "$.schemaVersion");
	return validateVersionTen({
		...root,
		schemaVersion: 10,
		operations: migrateOperationalConfigurationSectionV1(root.operations),
	});
}

function migrateVersionEight(root: Readonly<Record<string, unknown>>): OpenFabProjectVersionTen {
	expectExactKeys(
		root,
		[
			"kind",
			"schemaVersion",
			"manifest",
			"rail",
			"ports",
			"equipment",
			"blueprints",
			"areas",
			"scenarios",
			"view",
		],
		"$ v8",
	);
	expectLiteral(root.schemaVersion, 8, "$.schemaVersion");
	return validateVersionTen({
		...root,
		schemaVersion: 10,
		operations: emptyOperationalConfigurationState(),
	});
}

function migrateVersionSeven(root: Readonly<Record<string, unknown>>): OpenFabProjectVersionTen {
	expectExactKeys(
		root,
		[
			"kind",
			"schemaVersion",
			"manifest",
			"rail",
			"ports",
			"equipment",
			"blueprints",
			"areas",
			"scenarios",
			"view",
		],
		"$ v7",
	);
	expectLiteral(root.schemaVersion, 7, "$.schemaVersion");
	return validateNormalizedVersionTen({
		...root,
		schemaVersion: 10,
		operations: emptyOperationalConfigurationState(),
		blueprints: migrateBlueprintSectionV2(root.blueprints),
	});
}

function migrateVersionSix(root: Readonly<Record<string, unknown>>): OpenFabProjectVersionTen {
	expectExactKeys(
		root,
		[
			"kind",
			"schemaVersion",
			"manifest",
			"rail",
			"ports",
			"equipment",
			"blueprints",
			"areas",
			"scenarios",
			"view",
		],
		"$ v6",
	);
	expectLiteral(root.schemaVersion, 6, "$.schemaVersion");
	return validateNormalizedVersionTen({
		...root,
		schemaVersion: 10,
		operations: emptyOperationalConfigurationState(),
		blueprints: migrateBlueprintSectionV2(root.blueprints),
		areas: migrateOrganizationSectionV1(root.areas),
	});
}

function migrateVersionFive(root: Readonly<Record<string, unknown>>): OpenFabProjectVersionTen {
	expectExactKeys(
		root,
		[
			"kind",
			"schemaVersion",
			"manifest",
			"rail",
			"ports",
			"equipment",
			"blueprints",
			"areas",
			"scenarios",
			"view",
		],
		"$ v5",
	);
	expectLiteral(root.schemaVersion, 5, "$.schemaVersion");
	validateReservedSection(root.areas, "$.areas");
	return validateNormalizedVersionTen({
		...root,
		schemaVersion: 10,
		operations: emptyOperationalConfigurationState(),
		blueprints: migrateBlueprintSectionV2(root.blueprints),
		areas: createEmptyOpenFabProjectOrganizationSection(),
	});
}

function migrateVersionFour(root: Readonly<Record<string, unknown>>): OpenFabProjectVersionTen {
	expectExactKeys(
		root,
		[
			"kind",
			"schemaVersion",
			"manifest",
			"rail",
			"ports",
			"equipment",
			"blueprints",
			"areas",
			"scenarios",
			"view",
		],
		"$ v4",
	);
	expectLiteral(root.schemaVersion, 4, "$.schemaVersion");
	validateReservedSection(root.areas, "$.areas");
	return validateNormalizedVersionTen({
		...root,
		schemaVersion: 10,
		operations: emptyOperationalConfigurationState(),
		blueprints: migrateBlueprintSectionV1(root.blueprints),
		areas: createEmptyOpenFabProjectOrganizationSection(),
	});
}

function migrateVersionThree(root: Readonly<Record<string, unknown>>): OpenFabProjectVersionTen {
	expectExactKeys(root, VERSION_THREE_ROOT_KEYS, "$ v3");
	expectLiteral(root.schemaVersion, 3, "$.schemaVersion");
	validateReservedSection(root.areas, "$.areas");
	return validateNormalizedVersionTen({
		...root,
		schemaVersion: 10,
		operations: emptyOperationalConfigurationState(),
		blueprints: createEmptyOpenFabProjectBlueprintSection(),
		areas: createEmptyOpenFabProjectOrganizationSection(),
	});
}

function migrateVersionTwo(root: Readonly<Record<string, unknown>>): OpenFabProjectVersionTen {
	expectExactKeys(root, VERSION_THREE_ROOT_KEYS, "$ v2");
	expectLiteral(root.schemaVersion, 2, "$.schemaVersion");
	validateReservedSection(root.areas, "$.areas");
	const equipment = expectRecord(root.equipment, "$.equipment");
	const records = expectArray(equipment.records, "$.equipment.records");
	for (let index = 0; index < records.length; index++) {
		const record = records[index];
		if (
			typeof record === "object" &&
			record !== null &&
			!Array.isArray(record) &&
			(record as Readonly<Record<string, unknown>>).kind === "STK" &&
			(record as Readonly<Record<string, unknown>>).template === "FLEX"
		) {
			fail(
				"INVALID_FIELD",
				`$.equipment.records[${index}].template`,
				"schema v2 does not define the FLEX STK template",
			);
		}
	}
	return validateNormalizedVersionTen({
		...root,
		schemaVersion: 10,
		operations: emptyOperationalConfigurationState(),
		blueprints: createEmptyOpenFabProjectBlueprintSection(),
		areas: createEmptyOpenFabProjectOrganizationSection(),
	});
}

const VERSION_THREE_ROOT_KEYS = Object.freeze([
	"kind",
	"schemaVersion",
	"manifest",
	"rail",
	"ports",
	"equipment",
	"areas",
	"scenarios",
	"view",
]);

function migrateVersionOne(root: Readonly<Record<string, unknown>>): OpenFabProjectVersionTen {
	expectExactKeys(
		root,
		[
			"kind",
			"schemaVersion",
			"manifest",
			"rail",
			"ports",
			"equipment",
			"areas",
			"scenarios",
			"view",
		],
		"$ v1",
	);
	expectLiteral(root.kind, OPENFAB_PROJECT_KIND, "$.kind");
	expectLiteral(root.schemaVersion, 1, "$.schemaVersion");
	validateReservedSection(root.ports, "$.ports");
	validateReservedSection(root.equipment, "$.equipment");
	validateReservedSection(root.areas, "$.areas");
	validateReservedSection(root.scenarios, "$.scenarios");
	return validateNormalizedVersionTen({
		...root,
		schemaVersion: 10,
		operations: emptyOperationalConfigurationState(),
		ports: emptyPortSection(),
		equipment: emptyEquipmentSection(),
		blueprints: createEmptyOpenFabProjectBlueprintSection(),
		areas: createEmptyOpenFabProjectOrganizationSection(),
	});
}

function migrateVersionZero(root: Readonly<Record<string, unknown>>): OpenFabProjectVersionTen {
	expectExactKeys(root, ["kind", "schemaVersion", "manifest", "rail", "view"], "$ v0");
	const rail = expectRecord(root.rail, "$.rail");
	expectExactKeys(
		rail,
		["revision", "patchSequence", "nextAdvancedSwitchId", "cells", "advancedSwitches"],
		"$.rail v0",
	);
	return validateNormalizedVersionTen({
		kind: OPENFAB_PROJECT_KIND,
		schemaVersion: 10,
		manifest: root.manifest,
		rail: {
			grammar: OPENFAB_RAIL_GRAMMAR,
			cellSizeMillimeters: OPENFAB_RAIL_CELL_SIZE_MILLIMETERS,
			cellEncoding: OPENFAB_RAIL_CELL_ENCODING,
			...rail,
		},
		ports: emptyPortSection(),
		equipment: emptyEquipmentSection(),
		operations: emptyOperationalConfigurationState(),
		blueprints: createEmptyOpenFabProjectBlueprintSection(),
		areas: createEmptyOpenFabProjectOrganizationSection(),
		scenarios: emptyReservedSection(),
		view: root.view,
	});
}

export function validateOpenFabProjectManifest(value: unknown): OpenFabProjectManifest {
	const manifest = expectRecord(value, "$.manifest");
	expectExactKeys(manifest, ["id", "name", "createdAt", "updatedAt"], "$.manifest");
	const id = expectString(manifest.id, "$.manifest.id");
	if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id)) {
		fail(
			"INVALID_FIELD",
			"$.manifest.id",
			"project id must be 1-128 portable identifier characters",
		);
	}
	const name = expectString(manifest.name, "$.manifest.name");
	if (
		name.length === 0 ||
		name.length > 120 ||
		name !== name.trim() ||
		containsAsciiControlCharacter(name)
	) {
		fail(
			"INVALID_FIELD",
			"$.manifest.name",
			"project name must be a trimmed 1-120 character label",
		);
	}
	const createdAt = expectCanonicalTimestamp(manifest.createdAt, "$.manifest.createdAt");
	const updatedAt = expectCanonicalTimestamp(manifest.updatedAt, "$.manifest.updatedAt");
	if (updatedAt < createdAt) {
		fail("INVALID_FIELD", "$.manifest.updatedAt", "updatedAt cannot precede createdAt");
	}
	return Object.freeze({ id, name, createdAt, updatedAt });
}

function validateRailSection(value: unknown): OpenFabProject["rail"] {
	const rail = expectRecord(value, "$.rail");
	expectExactKeys(
		rail,
		[
			"grammar",
			"cellSizeMillimeters",
			"cellEncoding",
			"revision",
			"patchSequence",
			"nextAdvancedSwitchId",
			"cells",
			"advancedSwitches",
		],
		"$.rail",
	);
	expectLiteral(rail.grammar, OPENFAB_RAIL_GRAMMAR, "$.rail.grammar");
	expectLiteral(
		rail.cellSizeMillimeters,
		OPENFAB_RAIL_CELL_SIZE_MILLIMETERS,
		"$.rail.cellSizeMillimeters",
	);
	expectLiteral(rail.cellEncoding, OPENFAB_RAIL_CELL_ENCODING, "$.rail.cellEncoding");
	const revision = expectSafeNonNegativeInteger(rail.revision, "$.rail.revision");
	const patchSequence = expectSafeNonNegativeInteger(rail.patchSequence, "$.rail.patchSequence");
	const nextAdvancedSwitchId = expectSafeNonNegativeInteger(
		rail.nextAdvancedSwitchId,
		"$.rail.nextAdvancedSwitchId",
	);
	if (nextAdvancedSwitchId < 1 || nextAdvancedSwitchId > ADVANCED_SWITCH_MAX_ID + 1) {
		fail("INVALID_FIELD", "$.rail.nextAdvancedSwitchId", "advanced switch cursor is out of range");
	}

	const rawCells = expectArray(rail.cells, "$.rail.cells");
	if (rawCells.length > OPENFAB_PROJECT_MAX_RAIL_CELLS) {
		fail("LIMIT_EXCEEDED", "$.rail.cells", "rail cell count exceeds 1,000,000");
	}
	const cellKeys = new Set<string>();
	const cells = rawCells.map((cell, index) => {
		const path = `$.rail.cells[${index}]`;
		const tuple = expectArray(cell, path);
		if (tuple.length !== 3) fail("INVALID_FIELD", path, "rail cell must be [x, z, encoded]");
		const x = expectInt32(tuple[0], `${path}[0]`);
		const z = expectInt32(tuple[1], `${path}[1]`);
		const encoded = expectInteger(tuple[2], `${path}[2]`);
		if (encoded <= 0 || encoded > 0xff) {
			fail("INVALID_FIELD", `${path}[2]`, "rail cell encoding must be one non-zero byte");
		}
		const decoded = decodeRailCell(encoded);
		if (
			(decoded.incoming & decoded.outgoing) !== 0 ||
			bitCount(decoded.incoming | decoded.outgoing) > 3
		) {
			fail("INVALID_RAIL", path, "rail cell has overlapping or unsupported directed ports");
		}
		if (classifyRailCell(decoded) === "INVALID") {
			fail("INVALID_RAIL", path, "rail cell does not match the directed AMHS grammar");
		}
		const key = coordinateKey(x, z);
		if (cellKeys.has(key)) fail("DUPLICATE_VALUE", path, `duplicate rail cell ${key}`);
		cellKeys.add(key);
		return Object.freeze([x, z, encoded]) as OpenFabRailCellTuple;
	});
	cells.sort(compareCells);

	const rawSwitches = expectArray(rail.advancedSwitches, "$.rail.advancedSwitches");
	if (rawSwitches.length > OPENFAB_PROJECT_MAX_ADVANCED_SWITCHES) {
		fail("LIMIT_EXCEEDED", "$.rail.advancedSwitches", "advanced switch count exceeds 100,000");
	}
	const switchIds = new Set<number>();
	let maximumSwitchId = 0;
	const advancedSwitches = rawSwitches.map((entry, index) => {
		const path = `$.rail.advancedSwitches[${index}]`;
		const parsed = validateAdvancedSwitch(entry, path);
		if (switchIds.has(parsed.id)) {
			fail("DUPLICATE_VALUE", `${path}.id`, `duplicate advanced switch id ${parsed.id}`);
		}
		switchIds.add(parsed.id);
		maximumSwitchId = Math.max(maximumSwitchId, parsed.id);
		return parsed;
	});
	advancedSwitches.sort((left, right) => left.id - right.id);
	if (nextAdvancedSwitchId <= maximumSwitchId) {
		fail(
			"INVALID_FIELD",
			"$.rail.nextAdvancedSwitchId",
			"advanced switch cursor must be greater than every persisted switch id",
		);
	}

	return Object.freeze({
		grammar: OPENFAB_RAIL_GRAMMAR,
		cellSizeMillimeters: OPENFAB_RAIL_CELL_SIZE_MILLIMETERS,
		cellEncoding: OPENFAB_RAIL_CELL_ENCODING,
		revision,
		patchSequence,
		nextAdvancedSwitchId,
		cells: Object.freeze(cells),
		advancedSwitches: Object.freeze(advancedSwitches),
	});
}

function validateAdvancedSwitch(value: unknown, path: string): OpenFabProjectAdvancedSwitch {
	const switchRecord = expectRecord(value, path);
	expectExactKeys(
		switchRecord,
		["id", "profileClass", "origin", "forward", "lateral", "movementMask"],
		path,
	);
	const id = expectInteger(switchRecord.id, `${path}.id`);
	const profileClass = expectString(switchRecord.profileClass, `${path}.profileClass`);
	if (!ADVANCED_SWITCH_PROFILE_CLASSES.includes(profileClass as AdvancedSwitchProfileClass)) {
		fail("INVALID_FIELD", `${path}.profileClass`, "advanced switch profile must be A, B, C, or D");
	}
	const origin = expectArray(switchRecord.origin, `${path}.origin`);
	if (origin.length !== 2) fail("INVALID_FIELD", `${path}.origin`, "origin must be [x, z]");
	const forward = expectProjectDirection(switchRecord.forward, `${path}.forward`);
	const lateral = expectProjectDirection(switchRecord.lateral, `${path}.lateral`);
	const movementMask = expectInteger(switchRecord.movementMask, `${path}.movementMask`);
	const parsed = Object.freeze({
		id,
		profileClass: profileClass as AdvancedSwitchProfileClass,
		origin: Object.freeze([
			expectInt32(origin[0], `${path}.origin[0]`),
			expectInt32(origin[1], `${path}.origin[1]`),
		] as const),
		forward,
		lateral,
		movementMask,
	}) satisfies OpenFabProjectAdvancedSwitch;
	let recordError: string | null;
	try {
		recordError = advancedSwitchRecordError(openFabAdvancedSwitchToRecord(parsed));
	} catch (error) {
		recordError = error instanceof Error ? error.message : "advanced switch record is invalid";
	}
	if (recordError || movementMask !== ADVANCED_SWITCH_ALL_MOVEMENTS) {
		fail("INVALID_RAIL", path, recordError ?? "advanced switch movement mask is invalid");
	}
	return parsed;
}

function validatePortSection(value: unknown): OpenFabProjectPortSection {
	const section = expectRecord(value, "$.ports");
	expectExactKeys(section, ["schemaVersion", "nextPortId", "records"], "$.ports");
	expectLiteral(
		section.schemaVersion,
		OPENFAB_PORT_SECTION_SCHEMA_VERSION,
		"$.ports.schemaVersion",
	);
	const nextPortId = expectIdCursor(section.nextPortId, "$.ports.nextPortId");
	const rawRecords = expectArray(section.records, "$.ports.records");
	if (rawRecords.length > OPENFAB_PROJECT_MAX_PORTS) {
		fail("LIMIT_EXCEEDED", "$.ports.records", "port count exceeds 1,000,000");
	}
	const ids = new Set<number>();
	let maximumId = 0;
	const records = rawRecords.map((value, index) => {
		const path = `$.ports.records[${index}]`;
		const record = validatePort(value, path);
		if (ids.has(record.id)) fail("DUPLICATE_VALUE", `${path}.id`, `duplicate port id ${record.id}`);
		ids.add(record.id);
		maximumId = Math.max(maximumId, record.id);
		return record;
	});
	records.sort((left, right) => left.id - right.id);
	if (nextPortId <= maximumId) {
		fail("INVALID_FIELD", "$.ports.nextPortId", "port cursor must exceed every persisted port id");
	}
	return Object.freeze({
		schemaVersion: OPENFAB_PORT_SECTION_SCHEMA_VERSION,
		nextPortId,
		records: Object.freeze(records),
	});
}

function validatePort(value: unknown, path: string): OpenFabProjectPort {
	const port = expectRecord(value, path);
	expectExactKeys(
		port,
		[
			"id",
			"equipmentGroupId",
			"route",
			"stationMillimeters",
			"side",
			"lateralOffsetMillimeters",
			"direction",
			"portType",
			"barcode",
		],
		path,
	);
	const id = expectPositiveInt32(port.id, `${path}.id`);
	const equipmentGroupId = expectPositiveInt32(port.equipmentGroupId, `${path}.equipmentGroupId`);
	const route = validatePortRoute(port.route, `${path}.route`);
	const stationMillimeters = expectInt32(port.stationMillimeters, `${path}.stationMillimeters`);
	const side = expectEnum(port.side, PORT_SIDES, `${path}.side`) as PortSide;
	const lateralOffsetMillimeters = expectInteger(
		port.lateralOffsetMillimeters,
		`${path}.lateralOffsetMillimeters`,
	);
	const direction = expectEnum(
		port.direction,
		PORT_DIRECTIONS,
		`${path}.direction`,
	) as PortDirection;
	const portType = expectEnum(port.portType, PORT_TYPES, `${path}.portType`) as PortType;
	const barcode = port.barcode === null ? null : expectString(port.barcode, `${path}.barcode`);
	const parsed = Object.freeze({
		id,
		equipmentGroupId,
		route,
		stationMillimeters,
		side,
		lateralOffsetMillimeters,
		direction,
		portType,
		barcode,
	}) satisfies OpenFabProjectPort;
	let error: string | null;
	try {
		error = portRecordError(openFabProjectPortToRecord(parsed));
	} catch (cause) {
		error = cause instanceof Error ? cause.message : "port record is invalid";
	}
	if (error) fail("INVALID_PORT_EQUIPMENT", path, error);
	return parsed;
}

function validatePortRoute(value: unknown, path: string): OpenFabProjectPortRoute {
	const route = expectRecord(value, path);
	const kind = expectString(route.kind, `${path}.kind`);
	if (kind === "CARDINAL_CELL") {
		expectExactKeys(route, ["kind", "cell", "from", "to"], path);
		const cell = expectArray(route.cell, `${path}.cell`);
		if (cell.length !== 2) fail("INVALID_FIELD", `${path}.cell`, "port route cell must be [x, z]");
		return Object.freeze({
			kind,
			cell: Object.freeze([
				expectInt32(cell[0], `${path}.cell[0]`),
				expectInt32(cell[1], `${path}.cell[1]`),
			] as const),
			from: expectNullableProjectDirection(route.from, `${path}.from`),
			to: expectNullableProjectDirection(route.to, `${path}.to`),
		});
	}
	if (kind === "ADVANCED_SWITCH_SEGMENT") {
		expectExactKeys(
			route,
			["kind", "switchId", "profileClass", "role", "portIndex", "segmentOrdinal"],
			path,
		);
		const profileClass = expectEnum(
			route.profileClass,
			ADVANCED_SWITCH_PROFILE_CLASSES,
			`${path}.profileClass`,
		) as AdvancedSwitchProfileClass;
		const role = expectEnum(route.role, ADVANCED_SWITCH_ROUTE_ROLES, `${path}.role`) as
			| "INPUT"
			| "THROAT"
			| "OUTPUT";
		const portIndex =
			route.portIndex === null
				? null
				: (expectInteger(route.portIndex, `${path}.portIndex`) as 0 | 1);
		return Object.freeze({
			kind,
			switchId: expectPositiveInt32(route.switchId, `${path}.switchId`),
			profileClass,
			role,
			portIndex,
			segmentOrdinal: expectInteger(route.segmentOrdinal, `${path}.segmentOrdinal`),
		});
	}
	fail("INVALID_FIELD", `${path}.kind`, "unknown port route identity kind");
}

function validateEquipmentSection(value: unknown): OpenFabProjectEquipmentSection {
	const section = expectRecord(value, "$.equipment");
	expectExactKeys(section, ["schemaVersion", "nextEquipmentGroupId", "records"], "$.equipment");
	expectLiteral(
		section.schemaVersion,
		OPENFAB_EQUIPMENT_SECTION_SCHEMA_VERSION,
		"$.equipment.schemaVersion",
	);
	const nextEquipmentGroupId = expectIdCursor(
		section.nextEquipmentGroupId,
		"$.equipment.nextEquipmentGroupId",
	);
	const rawRecords = expectArray(section.records, "$.equipment.records");
	if (rawRecords.length > OPENFAB_PROJECT_MAX_EQUIPMENT_GROUPS) {
		fail("LIMIT_EXCEEDED", "$.equipment.records", "equipment group count exceeds 500,000");
	}
	const ids = new Set<number>();
	let maximumId = 0;
	const records = rawRecords.map((value, index) => {
		const path = `$.equipment.records[${index}]`;
		const record = validateEquipmentGroup(value, path);
		if (ids.has(record.id)) {
			fail("DUPLICATE_VALUE", `${path}.id`, `duplicate equipment group id ${record.id}`);
		}
		ids.add(record.id);
		maximumId = Math.max(maximumId, record.id);
		return record;
	});
	records.sort((left, right) => left.id - right.id);
	if (nextEquipmentGroupId <= maximumId) {
		fail(
			"INVALID_FIELD",
			"$.equipment.nextEquipmentGroupId",
			"equipment group cursor must exceed every persisted group id",
		);
	}
	return Object.freeze({
		schemaVersion: OPENFAB_EQUIPMENT_SECTION_SCHEMA_VERSION,
		nextEquipmentGroupId,
		records: Object.freeze(records),
	});
}

function migrateOperationalConfigurationSectionV1(value: unknown): OperationalConfigurationState {
	const path = "$.operations";
	const section = expectRecord(value, path);
	expectExactKeys(
		section,
		[
			"schemaVersion",
			"revision",
			"nextEqCapabilityId",
			"nextStorageClassId",
			"nextStoragePolicyId",
			"stationCapabilities",
			"eqCapabilities",
			"eqGroupQualifications",
			"eqPortQualificationOverrides",
			"storageClasses",
			"storagePolicies",
			"storageGroups",
			"vehicleProfile",
			"review",
		],
		path,
	);
	expectLiteral(
		section.schemaVersion,
		OPERATIONAL_CONFIGURATION_LEGACY_SCHEMA_VERSION,
		`${path}.schemaVersion`,
	);
	const legacy = {
		schemaVersion: OPERATIONAL_CONFIGURATION_LEGACY_SCHEMA_VERSION,
		revision: expectSafeNonNegativeInteger(section.revision, `${path}.revision`),
		nextEqCapabilityId: expectPositiveInt32(
			section.nextEqCapabilityId,
			`${path}.nextEqCapabilityId`,
		),
		nextStorageClassId: expectPositiveInt32(
			section.nextStorageClassId,
			`${path}.nextStorageClassId`,
		),
		nextStoragePolicyId: expectPositiveInt32(
			section.nextStoragePolicyId,
			`${path}.nextStoragePolicyId`,
		),
		stationCapabilities: validateOperationalStationCapabilities(
			section.stationCapabilities,
			`${path}.stationCapabilities`,
		),
		eqCapabilities: validateOperationalLogicalDefinitions(
			section.eqCapabilities,
			`${path}.eqCapabilities`,
		),
		eqGroupQualifications: validateOperationalEqGroupQualifications(
			section.eqGroupQualifications,
			`${path}.eqGroupQualifications`,
		),
		eqPortQualificationOverrides: validateOperationalEqPortQualificationOverrides(
			section.eqPortQualificationOverrides,
			`${path}.eqPortQualificationOverrides`,
		),
		storageClasses: validateOperationalLogicalDefinitions(
			section.storageClasses,
			`${path}.storageClasses`,
		),
		storagePolicies: validateOperationalStoragePolicies(
			section.storagePolicies,
			`${path}.storagePolicies`,
		),
		storageGroups: validateOperationalStorageGroups(section.storageGroups, `${path}.storageGroups`),
		vehicleProfile:
			section.vehicleProfile === null
				? null
				: validateOperationalVehicleProfile(section.vehicleProfile, `${path}.vehicleProfile`),
		review:
			section.review === null ? null : validateOperationalReview(section.review, `${path}.review`),
	} satisfies LegacyOperationalConfigurationStateV1;
	let migrated: OperationalConfigurationState;
	try {
		migrated = copyOperationalConfigurationState({
			schemaVersion: OPERATIONAL_CONFIGURATION_SCHEMA_VERSION,
			revision: legacy.revision,
			nextEqCapabilityId: legacy.nextEqCapabilityId,
			nextStorageClassId: legacy.nextStorageClassId,
			nextStoragePolicyId: legacy.nextStoragePolicyId,
			nextResidentHomeSlotId: 1,
			stationCapabilities: legacy.stationCapabilities,
			eqCapabilities: legacy.eqCapabilities,
			eqGroupQualifications: legacy.eqGroupQualifications,
			eqPortQualificationOverrides: legacy.eqPortQualificationOverrides,
			storageClasses: legacy.storageClasses,
			storagePolicies: legacy.storagePolicies,
			storageGroups: legacy.storageGroups,
			residentHomeSlots: [],
			vehicleProfile: legacy.vehicleProfile,
			review: null,
		});
	} catch (error) {
		fail(
			"INVALID_FIELD",
			path,
			error instanceof Error ? error.message : "legacy operational configuration is invalid",
		);
	}
	const canonicalLegacy = {
		schemaVersion: OPERATIONAL_CONFIGURATION_LEGACY_SCHEMA_VERSION,
		revision: migrated.revision,
		nextEqCapabilityId: migrated.nextEqCapabilityId,
		nextStorageClassId: migrated.nextStorageClassId,
		nextStoragePolicyId: migrated.nextStoragePolicyId,
		stationCapabilities: migrated.stationCapabilities,
		eqCapabilities: migrated.eqCapabilities,
		eqGroupQualifications: migrated.eqGroupQualifications,
		eqPortQualificationOverrides: migrated.eqPortQualificationOverrides,
		storageClasses: migrated.storageClasses,
		storagePolicies: migrated.storagePolicies,
		storageGroups: migrated.storageGroups,
		vehicleProfile: migrated.vehicleProfile,
		review: legacy.review,
	} satisfies LegacyOperationalConfigurationStateV1;
	if (
		legacy.review &&
		legacy.review.configurationFingerprint !== checksumOperationalConfigurationV1(canonicalLegacy)
	) {
		fail(
			"INVALID_FIELD",
			`${path}.review.configurationFingerprint`,
			"legacy operational review does not match schema-v1 configuration content",
		);
	}
	return legacy.review
		? reviewOperationalConfiguration(migrated, {
				revision: legacy.review.sourceRevision,
				authoredChecksum: legacy.review.sourceAuthoredChecksum,
			})
		: migrated;
}

function checksumOperationalConfigurationV1(state: LegacyOperationalConfigurationStateV1): string {
	const checksum = new OrderedTypedChecksum();
	checksum.addNumbers([
		state.schemaVersion,
		state.revision,
		state.nextEqCapabilityId,
		state.nextStorageClassId,
		state.nextStoragePolicyId,
		state.stationCapabilities.length,
		state.eqCapabilities.length,
		state.eqGroupQualifications.length,
		state.eqPortQualificationOverrides.length,
		state.storageClasses.length,
		state.storagePolicies.length,
		state.storageGroups.length,
		state.vehicleProfile ? 1 : 0,
	]);
	for (const record of state.stationCapabilities) {
		checksum.addNumber(record.portId);
		checksum.addCachedString(record.transferCapability);
	}
	for (const definition of state.eqCapabilities) {
		checksum.addNumber(definition.id);
		checksum.addString(definition.key);
	}
	for (const record of state.eqGroupQualifications) {
		checksum.addNumber(record.equipmentGroupId);
		checksum.addNumbers(record.capabilityIds);
	}
	for (const record of state.eqPortQualificationOverrides) {
		checksum.addNumber(record.portId);
		checksum.addNumbers(record.capabilityIds);
	}
	for (const definition of state.storageClasses) {
		checksum.addNumber(definition.id);
		checksum.addString(definition.key);
	}
	for (const definition of state.storagePolicies) {
		checksum.addNumber(definition.id);
		checksum.addString(definition.key);
		checksum.addNumbers([
			definition.storageClassId,
			definition.priorityRank,
			definition.minimumDwellMilliseconds,
		]);
	}
	for (const record of state.storageGroups) {
		checksum.addNumbers([
			record.equipmentGroupId,
			record.policyId,
			record.capacityUnits,
			record.initialOccupiedUnits,
			record.highWaterMarkUnits,
		]);
	}
	if (state.vehicleProfile) {
		checksum.addString(state.vehicleProfile.id);
		checksum.addNumbers([
			state.vehicleProfile.version,
			state.vehicleProfile.bodyLengthMillimeters,
			state.vehicleProfile.referenceToFrontMillimeters,
			state.vehicleProfile.referenceToRearMillimeters,
			state.vehicleProfile.bodyWidthMillimeters,
			state.vehicleProfile.lateralSafetyMarginMillimeters,
			state.vehicleProfile.frontSafetyMarginMillimeters,
			state.vehicleProfile.rearSafetyMarginMillimeters,
			state.vehicleProfile.maximumSpeedMillimetersPerSecond,
			state.vehicleProfile.controlReactionMilliseconds,
			state.vehicleProfile.minimumServiceDecelerationMillimetersPerSecondSquared,
		]);
	}
	return checksum.digest();
}

function validateOperationalConfigurationSection(value: unknown): OperationalConfigurationState {
	const path = "$.operations";
	const section = expectRecord(value, path);
	expectExactKeys(
		section,
		[
			"schemaVersion",
			"revision",
			"nextEqCapabilityId",
			"nextStorageClassId",
			"nextStoragePolicyId",
			"nextResidentHomeSlotId",
			"stationCapabilities",
			"eqCapabilities",
			"eqGroupQualifications",
			"eqPortQualificationOverrides",
			"storageClasses",
			"storagePolicies",
			"storageGroups",
			"residentHomeSlots",
			"vehicleProfile",
			"review",
		],
		path,
	);
	expectLiteral(
		section.schemaVersion,
		OPERATIONAL_CONFIGURATION_SCHEMA_VERSION,
		`${path}.schemaVersion`,
	);
	const parsed = {
		schemaVersion: OPERATIONAL_CONFIGURATION_SCHEMA_VERSION,
		revision: expectSafeNonNegativeInteger(section.revision, `${path}.revision`),
		nextEqCapabilityId: expectPositiveInt32(
			section.nextEqCapabilityId,
			`${path}.nextEqCapabilityId`,
		),
		nextStorageClassId: expectPositiveInt32(
			section.nextStorageClassId,
			`${path}.nextStorageClassId`,
		),
		nextStoragePolicyId: expectPositiveInt32(
			section.nextStoragePolicyId,
			`${path}.nextStoragePolicyId`,
		),
		nextResidentHomeSlotId: expectPositiveInt32(
			section.nextResidentHomeSlotId,
			`${path}.nextResidentHomeSlotId`,
		),
		stationCapabilities: validateOperationalStationCapabilities(
			section.stationCapabilities,
			`${path}.stationCapabilities`,
		),
		eqCapabilities: validateOperationalLogicalDefinitions(
			section.eqCapabilities,
			`${path}.eqCapabilities`,
		),
		eqGroupQualifications: validateOperationalEqGroupQualifications(
			section.eqGroupQualifications,
			`${path}.eqGroupQualifications`,
		),
		eqPortQualificationOverrides: validateOperationalEqPortQualificationOverrides(
			section.eqPortQualificationOverrides,
			`${path}.eqPortQualificationOverrides`,
		),
		storageClasses: validateOperationalLogicalDefinitions(
			section.storageClasses,
			`${path}.storageClasses`,
		),
		storagePolicies: validateOperationalStoragePolicies(
			section.storagePolicies,
			`${path}.storagePolicies`,
		),
		storageGroups: validateOperationalStorageGroups(section.storageGroups, `${path}.storageGroups`),
		residentHomeSlots: validateOperationalResidentHomeSlots(
			section.residentHomeSlots,
			`${path}.residentHomeSlots`,
		),
		vehicleProfile:
			section.vehicleProfile === null
				? null
				: validateOperationalVehicleProfile(section.vehicleProfile, `${path}.vehicleProfile`),
		review:
			section.review === null ? null : validateOperationalReview(section.review, `${path}.review`),
	} satisfies OperationalConfigurationState;
	try {
		return copyOperationalConfigurationState(parsed);
	} catch (error) {
		fail(
			"INVALID_FIELD",
			path,
			error instanceof Error ? error.message : "operational configuration is invalid",
		);
	}
}

function validateOperationalStationCapabilities(
	value: unknown,
	path: string,
): readonly OperationalStationCapabilityRecord[] {
	const raw = expectOperationalArray(value, path, OPENFAB_PROJECT_MAX_PORTS);
	return Object.freeze(
		raw.map((value, index) => {
			const recordPath = `${path}[${index}]`;
			const record = expectRecord(value, recordPath);
			expectExactKeys(record, ["portId", "transferCapability"], recordPath);
			const transferCapability = expectString(
				record.transferCapability,
				`${recordPath}.transferCapability`,
			);
			if (
				!OPERATIONAL_STATION_TRANSFER_CAPABILITIES.includes(
					transferCapability as OperationalStationCapabilityRecord["transferCapability"],
				)
			) {
				fail(
					"INVALID_FIELD",
					`${recordPath}.transferCapability`,
					"transfer capability must be PICKUP_ONLY, DROPOFF_ONLY, or BIDIRECTIONAL",
				);
			}
			return Object.freeze({
				portId: expectPositiveInt32(record.portId, `${recordPath}.portId`),
				transferCapability:
					transferCapability as OperationalStationCapabilityRecord["transferCapability"],
			});
		}),
	);
}

function validateOperationalLogicalDefinitions(
	value: unknown,
	path: string,
): readonly OperationalLogicalDefinition[] {
	const raw = expectOperationalArray(value, path, OPENFAB_PROJECT_MAX_OPERATIONAL_DEFINITIONS);
	return Object.freeze(
		raw.map((value, index) => {
			const recordPath = `${path}[${index}]`;
			const record = expectRecord(value, recordPath);
			expectExactKeys(record, ["id", "key"], recordPath);
			return Object.freeze({
				id: expectPositiveInt32(record.id, `${recordPath}.id`),
				key: expectString(record.key, `${recordPath}.key`),
			});
		}),
	);
}

function validateOperationalEqGroupQualifications(
	value: unknown,
	path: string,
): readonly OperationalEqGroupQualificationRecord[] {
	const raw = expectOperationalArray(value, path, OPENFAB_PROJECT_MAX_EQUIPMENT_GROUPS);
	return Object.freeze(
		raw.map((value, index) => {
			const recordPath = `${path}[${index}]`;
			const record = expectRecord(value, recordPath);
			expectExactKeys(record, ["equipmentGroupId", "capabilityIds"], recordPath);
			return Object.freeze({
				equipmentGroupId: expectPositiveInt32(
					record.equipmentGroupId,
					`${recordPath}.equipmentGroupId`,
				),
				capabilityIds: validateOperationalReferenceIds(
					record.capabilityIds,
					`${recordPath}.capabilityIds`,
				),
			});
		}),
	);
}

function validateOperationalEqPortQualificationOverrides(
	value: unknown,
	path: string,
): readonly OperationalEqPortQualificationOverrideRecord[] {
	const raw = expectOperationalArray(value, path, OPENFAB_PROJECT_MAX_PORTS);
	return Object.freeze(
		raw.map((value, index) => {
			const recordPath = `${path}[${index}]`;
			const record = expectRecord(value, recordPath);
			expectExactKeys(record, ["portId", "capabilityIds"], recordPath);
			return Object.freeze({
				portId: expectPositiveInt32(record.portId, `${recordPath}.portId`),
				capabilityIds: validateOperationalReferenceIds(
					record.capabilityIds,
					`${recordPath}.capabilityIds`,
				),
			});
		}),
	);
}

function validateOperationalStoragePolicies(
	value: unknown,
	path: string,
): readonly OperationalStoragePolicyDefinition[] {
	const raw = expectOperationalArray(value, path, OPENFAB_PROJECT_MAX_OPERATIONAL_DEFINITIONS);
	return Object.freeze(
		raw.map((value, index) => {
			const recordPath = `${path}[${index}]`;
			const record = expectRecord(value, recordPath);
			expectExactKeys(
				record,
				["id", "key", "storageClassId", "priorityRank", "minimumDwellMilliseconds"],
				recordPath,
			);
			return Object.freeze({
				id: expectPositiveInt32(record.id, `${recordPath}.id`),
				key: expectString(record.key, `${recordPath}.key`),
				storageClassId: expectPositiveInt32(record.storageClassId, `${recordPath}.storageClassId`),
				priorityRank: expectInteger(record.priorityRank, `${recordPath}.priorityRank`),
				minimumDwellMilliseconds: expectInteger(
					record.minimumDwellMilliseconds,
					`${recordPath}.minimumDwellMilliseconds`,
				),
			});
		}),
	);
}

function validateOperationalStorageGroups(
	value: unknown,
	path: string,
): readonly OperationalStorageGroupConfigurationRecord[] {
	const raw = expectOperationalArray(value, path, OPENFAB_PROJECT_MAX_EQUIPMENT_GROUPS);
	return Object.freeze(
		raw.map((value, index) => {
			const recordPath = `${path}[${index}]`;
			const record = expectRecord(value, recordPath);
			expectExactKeys(
				record,
				[
					"equipmentGroupId",
					"policyId",
					"capacityUnits",
					"initialOccupiedUnits",
					"highWaterMarkUnits",
				],
				recordPath,
			);
			return Object.freeze({
				equipmentGroupId: expectPositiveInt32(
					record.equipmentGroupId,
					`${recordPath}.equipmentGroupId`,
				),
				policyId: expectPositiveInt32(record.policyId, `${recordPath}.policyId`),
				capacityUnits: expectInteger(record.capacityUnits, `${recordPath}.capacityUnits`),
				initialOccupiedUnits: expectInteger(
					record.initialOccupiedUnits,
					`${recordPath}.initialOccupiedUnits`,
				),
				highWaterMarkUnits: expectInteger(
					record.highWaterMarkUnits,
					`${recordPath}.highWaterMarkUnits`,
				),
			});
		}),
	);
}

function validateOperationalResidentHomeSlots(
	value: unknown,
	path: string,
): readonly OperationalResidentHomeSlotRecord[] {
	const raw = expectOperationalArray(value, path, OPERATIONAL_RESIDENT_HOME_SLOT_LIMIT);
	return Object.freeze(
		raw.map((value, index) => {
			const recordPath = `${path}[${index}]`;
			const record = expectRecord(value, recordPath);
			expectExactKeys(record, ["id", "vehicleId", "anchorPortId", "policy"], recordPath);
			expectLiteral(record.policy, OPERATIONAL_RESIDENT_HOME_SLOT_POLICY, `${recordPath}.policy`);
			return Object.freeze({
				id: expectPositiveInt32(record.id, `${recordPath}.id`),
				vehicleId: expectString(record.vehicleId, `${recordPath}.vehicleId`),
				anchorPortId: expectPositiveInt32(record.anchorPortId, `${recordPath}.anchorPortId`),
				policy: OPERATIONAL_RESIDENT_HOME_SLOT_POLICY,
			});
		}),
	);
}

function validateOperationalVehicleProfile(
	value: unknown,
	path: string,
): OperationalVehicleReservationProfile {
	const profile = expectRecord(value, path);
	expectExactKeys(
		profile,
		[
			"id",
			"version",
			"bodyLengthMillimeters",
			"referenceToFrontMillimeters",
			"referenceToRearMillimeters",
			"bodyWidthMillimeters",
			"lateralSafetyMarginMillimeters",
			"frontSafetyMarginMillimeters",
			"rearSafetyMarginMillimeters",
			"maximumSpeedMillimetersPerSecond",
			"controlReactionMilliseconds",
			"minimumServiceDecelerationMillimetersPerSecondSquared",
		],
		path,
	);
	return Object.freeze({
		id: expectString(profile.id, `${path}.id`),
		version: expectInteger(profile.version, `${path}.version`),
		bodyLengthMillimeters: expectInteger(
			profile.bodyLengthMillimeters,
			`${path}.bodyLengthMillimeters`,
		),
		referenceToFrontMillimeters: expectInteger(
			profile.referenceToFrontMillimeters,
			`${path}.referenceToFrontMillimeters`,
		),
		referenceToRearMillimeters: expectInteger(
			profile.referenceToRearMillimeters,
			`${path}.referenceToRearMillimeters`,
		),
		bodyWidthMillimeters: expectInteger(
			profile.bodyWidthMillimeters,
			`${path}.bodyWidthMillimeters`,
		),
		lateralSafetyMarginMillimeters: expectInteger(
			profile.lateralSafetyMarginMillimeters,
			`${path}.lateralSafetyMarginMillimeters`,
		),
		frontSafetyMarginMillimeters: expectInteger(
			profile.frontSafetyMarginMillimeters,
			`${path}.frontSafetyMarginMillimeters`,
		),
		rearSafetyMarginMillimeters: expectInteger(
			profile.rearSafetyMarginMillimeters,
			`${path}.rearSafetyMarginMillimeters`,
		),
		maximumSpeedMillimetersPerSecond: expectInteger(
			profile.maximumSpeedMillimetersPerSecond,
			`${path}.maximumSpeedMillimetersPerSecond`,
		),
		controlReactionMilliseconds: expectInteger(
			profile.controlReactionMilliseconds,
			`${path}.controlReactionMilliseconds`,
		),
		minimumServiceDecelerationMillimetersPerSecondSquared: expectInteger(
			profile.minimumServiceDecelerationMillimetersPerSecondSquared,
			`${path}.minimumServiceDecelerationMillimetersPerSecondSquared`,
		),
	});
}

function validateOperationalReview(value: unknown, path: string): OperationalConfigurationReview {
	const review = expectRecord(value, path);
	expectExactKeys(
		review,
		["sourceRevision", "sourceAuthoredChecksum", "configurationFingerprint"],
		path,
	);
	return Object.freeze({
		sourceRevision: expectSafeNonNegativeInteger(review.sourceRevision, `${path}.sourceRevision`),
		sourceAuthoredChecksum: expectString(
			review.sourceAuthoredChecksum,
			`${path}.sourceAuthoredChecksum`,
		),
		configurationFingerprint: expectString(
			review.configurationFingerprint,
			`${path}.configurationFingerprint`,
		),
	});
}

function validateOperationalReferenceIds(value: unknown, path: string): readonly number[] {
	const raw = expectOperationalArray(value, path, OPENFAB_PROJECT_MAX_OPERATIONAL_DEFINITIONS);
	return Object.freeze(raw.map((id, index) => expectPositiveInt32(id, `${path}[${index}]`)));
}

function expectOperationalArray(value: unknown, path: string, limit: number): readonly unknown[] {
	const array = expectArray(value, path);
	if (array.length > limit) {
		fail("LIMIT_EXCEEDED", path, `operational record count exceeds ${limit}`);
	}
	return array;
}

function validateEquipmentGroup(value: unknown, path: string): OpenFabProjectEquipmentGroup {
	const group = expectRecord(value, path);
	const kind = expectEnum(group.kind, EQUIPMENT_GROUP_KINDS, `${path}.kind`);
	let parsed: EquipmentGroupRecord;
	if (kind === "OHB") {
		expectExactKeys(group, ["id", "kind", "template", "portIds"], path);
		parsed = Object.freeze({
			id: expectPositiveInt32(group.id, `${path}.id`),
			kind,
			template: expectLiteralValue(group.template, "SINGLE", `${path}.template`),
			portIds: validatePortIds(group.portIds, `${path}.portIds`),
		});
	} else if (kind === "EQ") {
		expectExactKeys(group, ["id", "kind", "portIds", "pitchMillimeters", "recipe"], path);
		parsed = Object.freeze({
			id: expectPositiveInt32(group.id, `${path}.id`),
			kind,
			portIds: validatePortIds(group.portIds, `${path}.portIds`),
			pitchMillimeters: expectInteger(group.pitchMillimeters, `${path}.pitchMillimeters`),
			recipe: group.recipe === null ? null : expectString(group.recipe, `${path}.recipe`),
		});
	} else {
		expectExactKeys(group, ["id", "kind", "template", "portIds"], path);
		parsed = Object.freeze({
			id: expectPositiveInt32(group.id, `${path}.id`),
			kind: "STK",
			template: expectEnum(group.template, STK_EQUIPMENT_TEMPLATES, `${path}.template`),
			portIds: validatePortIds(group.portIds, `${path}.portIds`),
		});
	}
	const error = equipmentGroupError(parsed);
	if (error) fail("INVALID_PORT_EQUIPMENT", path, error);
	return parsed;
}

function validatePortIds(value: unknown, path: string): readonly number[] {
	const raw = expectArray(value, path);
	return Object.freeze(raw.map((id, index) => expectPositiveInt32(id, `${path}[${index}]`)));
}

function validatePortEquipment(project: OpenFabProjectAuthoredSource): void {
	const error = portEquipmentStateError({
		nextPortId: project.ports.nextPortId,
		nextEquipmentGroupId: project.equipment.nextEquipmentGroupId,
		ports: project.ports.records.map(openFabProjectPortToRecord),
		equipmentGroups: project.equipment.records,
	});
	if (error) fail("INVALID_PORT_EQUIPMENT", "$.ports", error);
}

function validateAuthoredRail(project: OpenFabProjectAuthoredSource): void {
	const values = new Map<string, number>();
	for (const [x, z, encoded] of project.rail.cells) values.set(coordinateKey(x, z), encoded);
	for (const [x, z, encoded] of project.rail.cells) {
		const rail = decodeRailCell(encoded);
		for (const direction of ALL_DIRECTIONS) {
			const neighbor = moveCell({ x, y: z }, direction);
			const neighborEncoded = values.get(coordinateKey(neighbor.x, neighbor.y)) ?? 0;
			const neighborRail = decodeRailCell(neighborEncoded);
			const reciprocal = oppositeDirection(direction);
			if (
				((rail.outgoing & direction) !== 0 && (neighborRail.incoming & reciprocal) === 0) ||
				((rail.incoming & direction) !== 0 && (neighborRail.outgoing & reciprocal) === 0)
			) {
				fail(
					"INVALID_RAIL",
					`$.rail.cells(${x},${z})`,
					`directed port ${direction} is not reciprocal at ${neighbor.x},${neighbor.y}`,
				);
			}
		}
	}

	const claimedCells = new Map<string, number>();
	for (const persisted of project.rail.advancedSwitches) {
		const record = openFabAdvancedSwitchToRecord(persisted);
		for (const claimed of deriveAdvancedSwitchGeometry(record).claimedCells) {
			const key = coordinateKey(claimed.x, claimed.y);
			const owner = claimedCells.get(key);
			if (owner !== undefined && owner !== record.id) {
				fail(
					"INVALID_RAIL",
					"$.rail.advancedSwitches",
					`advanced switches ${owner} and ${record.id} overlap at ${key}`,
				);
			}
			claimedCells.set(key, record.id);
		}
		const issue = validateAdvancedSwitchTopology(
			(x, z) => values.get(coordinateKey(x, z)) ?? 0,
			record,
		)[0];
		if (issue) {
			fail("INVALID_RAIL", `$.rail.advancedSwitches(id=${record.id})`, issue.message);
		}
	}
}

/** A legacy record envelope may contain only the original bundle v1 grammar. */
export function parseLegacyOpenFabProjectBlueprintValue(value: unknown): OpenFabProjectBlueprint {
	const section = migrateBlueprintSectionV3({ schemaVersion: 3, records: [value] });
	return section.records[0] as OpenFabProjectBlueprint;
}

function migrateBlueprintSectionV3(value: unknown): OpenFabProjectBlueprintSection {
	return validateBlueprintSection(value, 3, (value, path) => {
		const record = expectRecord(value, path);
		const kind = expectString(record.kind, `${path}.kind`);
		if (kind === OPENFAB_BLUEPRINT_KIND_RAIL_AREA)
			return validateRailAreaBlueprintRecord(record, path);
		if (kind === OPENFAB_BLUEPRINT_KIND_STATIC_FAB)
			return validateStaticFabBlueprintRecord(record, path);
		if (kind === OPENFAB_BLUEPRINT_KIND_STATIC_FAB_ORGANIZATION) {
			return validateStaticFabOrganizationBlueprintRecord(record, path, true);
		}
		fail("INVALID_FIELD", `${path}.kind`, "unknown blueprint kind");
	});
}

function validateBlueprintSectionV4(value: unknown): OpenFabProjectBlueprintSection {
	return validateBlueprintSection(
		value,
		OPENFAB_BLUEPRINT_SECTION_SCHEMA_VERSION,
		(record, path) => {
			const parsed = expectRecord(record, path);
			const kind = expectString(parsed.kind, `${path}.kind`);
			if (kind === OPENFAB_BLUEPRINT_KIND_RAIL_AREA)
				return validateRailAreaBlueprintRecord(parsed, path);
			if (kind === OPENFAB_BLUEPRINT_KIND_STATIC_FAB)
				return validateStaticFabBlueprintRecord(parsed, path);
			if (kind === OPENFAB_BLUEPRINT_KIND_STATIC_FAB_ORGANIZATION)
				return validateStaticFabOrganizationBlueprintRecord(parsed, path);
			fail("INVALID_FIELD", `${path}.kind`, "unknown blueprint kind");
		},
	);
}

function migrateBlueprintSectionV2(value: unknown): OpenFabProjectBlueprintSection {
	return validateBlueprintSection(value, 2, (record, path) => {
		const parsed = expectRecord(record, path);
		const kind = expectString(parsed.kind, `${path}.kind`);
		if (kind === OPENFAB_BLUEPRINT_KIND_RAIL_AREA)
			return validateRailAreaBlueprintRecord(parsed, path);
		if (kind === OPENFAB_BLUEPRINT_KIND_STATIC_FAB)
			return validateStaticFabBlueprintRecord(parsed, path);
		fail("INVALID_FIELD", `${path}.kind`, "schema v2 does not define this blueprint kind");
	});
}

function migrateBlueprintSectionV1(value: unknown): OpenFabProjectBlueprintSection {
	return validateBlueprintSection(value, 1, (record, path) =>
		validateRailAreaBlueprintRecord(expectRecord(record, path), path),
	);
}

function validateBlueprintSection(
	value: unknown,
	expectedSchemaVersion: number,
	parseRecord: (value: unknown, path: string) => OpenFabProjectBlueprint,
): OpenFabProjectBlueprintSection {
	const path = "$.blueprints";
	const section = expectRecord(value, path);
	expectExactKeys(section, ["schemaVersion", "records"], path);
	expectLiteral(section.schemaVersion, expectedSchemaVersion, `${path}.schemaVersion`);
	const rawRecords = expectArray(section.records, `${path}.records`);
	if (rawRecords.length > OPENFAB_BLUEPRINT_MAX_RECORDS) {
		fail(
			"LIMIT_EXCEEDED",
			`${path}.records`,
			`blueprint count exceeds ${OPENFAB_BLUEPRINT_MAX_RECORDS}`,
		);
	}
	const ids = new Set<string>();
	const labels = new Set<string>();
	let totalEdges = 0;
	const records = rawRecords.map((record, index) => {
		const recordPath = `${path}.records[${index}]`;
		const parsed = parseRecord(record, recordPath);
		if (ids.has(parsed.id)) {
			fail("DUPLICATE_VALUE", `${recordPath}.id`, `duplicate blueprint id ${parsed.id}`);
		}
		ids.add(parsed.id);
		const labelKey = `${parsed.folder}/${parsed.name}`.toLocaleLowerCase("en-US");
		if (labels.has(labelKey)) {
			fail(
				"DUPLICATE_VALUE",
				`${recordPath}.name`,
				"blueprint names must be unique within a folder",
			);
		}
		labels.add(labelKey);
		totalEdges += parsed.edges.length;
		if (totalEdges > OPENFAB_BLUEPRINT_MAX_TOTAL_EDGES) {
			fail(
				"LIMIT_EXCEEDED",
				`${path}.records`,
				`blueprint edge total exceeds ${OPENFAB_BLUEPRINT_MAX_TOTAL_EDGES}`,
			);
		}
		return parsed;
	});
	records.sort((left, right) => left.id.localeCompare(right.id, "en-US"));
	return Object.freeze({
		schemaVersion: OPENFAB_BLUEPRINT_SECTION_SCHEMA_VERSION,
		records: Object.freeze(records),
	});
}

function validateRailAreaBlueprintRecord(
	record: Readonly<Record<string, unknown>>,
	path: string,
): OpenFabProjectBlueprint {
	expectExactKeys(
		record,
		[
			"id",
			"kind",
			"name",
			"folder",
			"favorite",
			"createdAt",
			"updatedAt",
			"sourceModuleCount",
			"widthMeters",
			"heightMeters",
			"edges",
		],
		path,
	);
	const id = expectString(record.id, `${path}.id`);
	if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id)) {
		fail("INVALID_FIELD", `${path}.id`, "blueprint id must be a portable 1-128 character id");
	}
	expectLiteral(record.kind, OPENFAB_BLUEPRINT_KIND_RAIL_AREA, `${path}.kind`);
	const name = expectBlueprintLabel(record.name, `${path}.name`, 80, false);
	const folder = expectBlueprintFolder(record.folder, `${path}.folder`);
	if (typeof record.favorite !== "boolean") {
		fail("INVALID_FIELD", `${path}.favorite`, "favorite must be boolean");
	}
	const createdAt = expectCanonicalTimestamp(record.createdAt, `${path}.createdAt`);
	const updatedAt = expectCanonicalTimestamp(record.updatedAt, `${path}.updatedAt`);
	if (updatedAt < createdAt) {
		fail("INVALID_FIELD", `${path}.updatedAt`, "updatedAt cannot precede createdAt");
	}
	const sourceModuleCount = expectSafeNonNegativeInteger(
		record.sourceModuleCount,
		`${path}.sourceModuleCount`,
	);
	if (sourceModuleCount < 1) {
		fail("INVALID_FIELD", `${path}.sourceModuleCount`, "source module count must be positive");
	}
	const widthMeters = expectSafeNonNegativeInteger(record.widthMeters, `${path}.widthMeters`);
	const heightMeters = expectSafeNonNegativeInteger(record.heightMeters, `${path}.heightMeters`);
	if (widthMeters === 0 && heightMeters === 0) {
		fail("INVALID_FIELD", path, "rail-area blueprint must span at least one meter");
	}
	const edges = validateBlueprintEdges(record.edges, path, widthMeters, heightMeters);
	return Object.freeze({
		id,
		kind: OPENFAB_BLUEPRINT_KIND_RAIL_AREA,
		name,
		folder,
		favorite: record.favorite,
		createdAt,
		updatedAt,
		sourceModuleCount,
		widthMeters,
		heightMeters,
		edges,
	});
}

function validateStaticFabBlueprintRecord(
	record: Readonly<Record<string, unknown>>,
	path: string,
): OpenFabStaticFabBlueprint {
	expectExactKeys(
		record,
		[
			"id",
			"kind",
			"name",
			"folder",
			"favorite",
			"createdAt",
			"updatedAt",
			"sourceModuleCount",
			"widthMeters",
			"heightMeters",
			"edges",
			"ports",
			"equipmentGroups",
		],
		path,
	);
	const id = validateBlueprintId(record.id, path);
	expectLiteral(record.kind, OPENFAB_BLUEPRINT_KIND_STATIC_FAB, `${path}.kind`);
	const name = expectBlueprintLabel(record.name, `${path}.name`, 80, false);
	const folder = expectBlueprintFolder(record.folder, `${path}.folder`);
	if (typeof record.favorite !== "boolean") {
		fail("INVALID_FIELD", `${path}.favorite`, "favorite must be boolean");
	}
	const createdAt = expectCanonicalTimestamp(record.createdAt, `${path}.createdAt`);
	const updatedAt = expectCanonicalTimestamp(record.updatedAt, `${path}.updatedAt`);
	if (updatedAt < createdAt) {
		fail("INVALID_FIELD", `${path}.updatedAt`, "updatedAt cannot precede createdAt");
	}
	const sourceModuleCount = expectSafeNonNegativeInteger(
		record.sourceModuleCount,
		`${path}.sourceModuleCount`,
	);
	if (sourceModuleCount < 1) {
		fail("INVALID_FIELD", `${path}.sourceModuleCount`, "source module count must be positive");
	}
	const widthMeters = expectSafeNonNegativeInteger(record.widthMeters, `${path}.widthMeters`);
	const heightMeters = expectSafeNonNegativeInteger(record.heightMeters, `${path}.heightMeters`);
	if (widthMeters === 0 && heightMeters === 0) {
		fail("INVALID_FIELD", path, "static FAB blueprint must span at least one meter");
	}
	const edges = validateBlueprintEdges(record.edges, path, widthMeters, heightMeters);
	const ports = validateStaticFabBlueprintPorts(record.ports, path);
	const equipmentGroups = validateStaticFabBlueprintEquipmentGroups(record.equipmentGroups, path);
	validateStaticFabBlueprintLayout(edges, ports, equipmentGroups, path);
	return Object.freeze({
		id,
		kind: OPENFAB_BLUEPRINT_KIND_STATIC_FAB,
		name,
		folder,
		favorite: record.favorite,
		createdAt,
		updatedAt,
		sourceModuleCount,
		widthMeters,
		heightMeters,
		edges,
		ports,
		equipmentGroups,
	});
}

/** Validate the old envelope before adding empty identity; never infer historical relationships. */
function migrateOrganizationBundleV1(value: unknown, path: string): unknown {
	const bundle = expectRecord(value, path);
	expectExactKeys(
		bundle,
		[
			"version",
			"captureMode",
			"rootOrganizationIndices",
			"sourceModuleCount",
			"sourceWidthMeters",
			"sourceHeightMeters",
			"railEdges",
			"advancedSwitches",
			"ports",
			"equipmentGroups",
			"organizations",
		],
		path,
	);
	expectLiteral(bundle.version, 1, `${path}.version`);
	return { ...bundle, version: 2, relationships: emptyStaticFabAssemblyRelationshipState() };
}

function validateStaticFabOrganizationBlueprintRecord(
	record: Readonly<Record<string, unknown>>,
	path: string,
	legacyBundle = false,
): OpenFabStaticFabOrganizationBlueprint {
	expectExactKeys(
		record,
		[
			"id",
			"kind",
			"name",
			"folder",
			"favorite",
			"createdAt",
			"updatedAt",
			"sourceModuleCount",
			"widthMeters",
			"heightMeters",
			"edges",
			"bundle",
		],
		path,
	);
	const id = validateBlueprintId(record.id, path);
	expectLiteral(record.kind, OPENFAB_BLUEPRINT_KIND_STATIC_FAB_ORGANIZATION, `${path}.kind`);
	const name = expectBlueprintLabel(record.name, `${path}.name`, 80, false);
	const folder = expectBlueprintFolder(record.folder, `${path}.folder`);
	if (typeof record.favorite !== "boolean") {
		fail("INVALID_FIELD", `${path}.favorite`, "favorite must be boolean");
	}
	const createdAt = expectCanonicalTimestamp(record.createdAt, `${path}.createdAt`);
	const updatedAt = expectCanonicalTimestamp(record.updatedAt, `${path}.updatedAt`);
	if (updatedAt < createdAt) {
		fail("INVALID_FIELD", `${path}.updatedAt`, "updatedAt cannot precede createdAt");
	}
	const bundleInput = legacyBundle
		? migrateOrganizationBundleV1(record.bundle, `${path}.bundle`)
		: record.bundle;
	const prepared = prepareStaticFabOrganizationBundle(bundleInput);
	if (!prepared.valid) {
		fail("INVALID_ORGANIZATION", `${path}.bundle`, prepared.reason);
	}
	const bundle = prepared.bundle;
	const sourceModuleCount = expectSafeNonNegativeInteger(
		record.sourceModuleCount,
		`${path}.sourceModuleCount`,
	);
	const widthMeters = expectSafeNonNegativeInteger(record.widthMeters, `${path}.widthMeters`);
	const heightMeters = expectSafeNonNegativeInteger(record.heightMeters, `${path}.heightMeters`);
	if (sourceModuleCount !== bundle.sourceModuleCount) {
		fail(
			"INVALID_ORGANIZATION",
			`${path}.sourceModuleCount`,
			"organization blueprint summary must match its portable bundle",
		);
	}
	if (widthMeters !== bundle.sourceWidthMeters || heightMeters !== bundle.sourceHeightMeters) {
		fail(
			"INVALID_ORGANIZATION",
			`${path}.widthMeters`,
			"organization blueprint bounds must match its portable bundle",
		);
	}
	const edges = validateStaticFabOrganizationBlueprintEdges(record.edges, bundle, path);
	return Object.freeze({
		id,
		kind: OPENFAB_BLUEPRINT_KIND_STATIC_FAB_ORGANIZATION,
		name,
		folder,
		favorite: record.favorite,
		createdAt,
		updatedAt,
		sourceModuleCount,
		widthMeters,
		heightMeters,
		edges,
		bundle,
	});
}

function validateStaticFabOrganizationBlueprintEdges(
	value: unknown,
	bundle: StaticFabOrganizationBundle,
	path: string,
): readonly OpenFabBlueprintEdgeTuple[] {
	const rawEdges = expectArray(value, `${path}.edges`);
	if (rawEdges.length !== bundle.railEdges.length) {
		fail(
			"INVALID_ORGANIZATION",
			`${path}.edges`,
			"organization blueprint rail summary must match its portable bundle",
		);
	}
	return Object.freeze(
		bundle.railEdges.map((edge, index) => {
			const edgePath = `${path}.edges[${index}]`;
			const tuple = expectArray(rawEdges[index], edgePath);
			if (tuple.length !== 4) {
				fail("INVALID_FIELD", edgePath, "edge must be [fromX, fromZ, toX, toZ]");
			}
			const actual = [
				expectInt32(tuple[0], `${edgePath}[0]`),
				expectInt32(tuple[1], `${edgePath}[1]`),
				expectInt32(tuple[2], `${edgePath}[2]`),
				expectInt32(tuple[3], `${edgePath}[3]`),
			] as const;
			const expected = [edge.from.x, edge.from.y, edge.to.x, edge.to.y] as const;
			if (actual.some((coordinate, coordinateIndex) => coordinate !== expected[coordinateIndex])) {
				fail(
					"INVALID_ORGANIZATION",
					edgePath,
					"organization blueprint rail summary must exactly project its portable bundle",
				);
			}
			return Object.freeze(expected);
		}),
	);
}

function validateBlueprintId(value: unknown, path: string): string {
	const id = expectString(value, `${path}.id`);
	if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id)) {
		fail("INVALID_FIELD", `${path}.id`, "blueprint id must be a portable 1-128 character id");
	}
	return id;
}

function validateStaticFabBlueprintPorts(
	value: unknown,
	path: string,
): readonly OpenFabStaticFabBlueprintPort[] {
	const rawPorts = expectArray(value, `${path}.ports`);
	if (rawPorts.length === 0 || rawPorts.length > STATIC_FAB_BLUEPRINT_MAX_PORTS) {
		fail(
			"LIMIT_EXCEEDED",
			`${path}.ports`,
			`static FAB blueprints require 1-${STATIC_FAB_BLUEPRINT_MAX_PORTS} portable ports`,
		);
	}
	return Object.freeze(
		rawPorts.map((value, index) => {
			const portPath = `${path}.ports[${index}]`;
			const port = expectRecord(value, portPath);
			expectExactKeys(
				port,
				[
					"equipmentGroupIndex",
					"route",
					"stationMillimeters",
					"side",
					"lateralOffsetMillimeters",
					"direction",
					"portType",
				],
				portPath,
			);
			const routePath = `${portPath}.route`;
			const route = expectRecord(port.route, routePath);
			expectExactKeys(route, ["kind", "cell", "from", "to"], routePath);
			expectLiteral(route.kind, "CARDINAL_CELL", `${routePath}.kind`);
			const cell = expectArray(route.cell, `${routePath}.cell`);
			if (cell.length !== 2) {
				fail("INVALID_FIELD", `${routePath}.cell`, "portable port route cell must be [x, z]");
			}
			const from = expectEnum(
				route.from,
				OPENFAB_PROJECT_DIRECTION_NAMES,
				`${routePath}.from`,
			) as OpenFabProjectDirection;
			const to = expectEnum(
				route.to,
				OPENFAB_PROJECT_DIRECTION_NAMES,
				`${routePath}.to`,
			) as OpenFabProjectDirection;
			const parsed = Object.freeze({
				equipmentGroupIndex: expectSafeNonNegativeInteger(
					port.equipmentGroupIndex,
					`${portPath}.equipmentGroupIndex`,
				),
				route: Object.freeze({
					kind: "CARDINAL_CELL" as const,
					cell: Object.freeze([
						expectInt32(cell[0], `${routePath}.cell[0]`),
						expectInt32(cell[1], `${routePath}.cell[1]`),
					] as const),
					from,
					to,
				}),
				stationMillimeters: expectInteger(
					port.stationMillimeters,
					`${portPath}.stationMillimeters`,
				),
				side: expectEnum(port.side, PORT_SIDES, `${portPath}.side`) as PortSide,
				lateralOffsetMillimeters: expectInteger(
					port.lateralOffsetMillimeters,
					`${portPath}.lateralOffsetMillimeters`,
				),
				direction: expectEnum(
					port.direction,
					PORT_DIRECTIONS,
					`${portPath}.direction`,
				) as PortDirection,
				portType: expectEnum(port.portType, PORT_TYPES, `${portPath}.portType`) as PortType,
			}) satisfies OpenFabStaticFabBlueprintPort;
			if (parsed.stationMillimeters !== 500) {
				fail(
					"INVALID_PORT_EQUIPMENT",
					`${portPath}.stationMillimeters`,
					"static FAB blueprint ports must use the 500 mm cell-center station",
				);
			}
			return parsed;
		}),
	);
}

function validateStaticFabBlueprintEquipmentGroups(
	value: unknown,
	path: string,
): readonly OpenFabStaticFabBlueprintEquipmentGroup[] {
	const rawGroups = expectArray(value, `${path}.equipmentGroups`);
	if (rawGroups.length === 0 || rawGroups.length > STATIC_FAB_BLUEPRINT_MAX_EQUIPMENT_GROUPS) {
		fail(
			"LIMIT_EXCEEDED",
			`${path}.equipmentGroups`,
			`static FAB blueprints require 1-${STATIC_FAB_BLUEPRINT_MAX_EQUIPMENT_GROUPS} equipment groups`,
		);
	}
	return Object.freeze(
		rawGroups.map((value, index) => {
			const groupPath = `${path}.equipmentGroups[${index}]`;
			const group = expectRecord(value, groupPath);
			const kind = expectEnum(group.kind, EQUIPMENT_GROUP_KINDS, `${groupPath}.kind`);
			const portIndices = validateBlueprintPortIndices(
				group.portIndices,
				`${groupPath}.portIndices`,
			);
			if (kind === "OHB") {
				expectExactKeys(group, ["kind", "template", "portIndices"], groupPath);
				return Object.freeze({
					kind: "OHB" as const,
					template: expectLiteralValue(group.template, "SINGLE", `${groupPath}.template`),
					portIndices,
				});
			}
			if (kind === "EQ") {
				expectExactKeys(group, ["kind", "pitchMillimeters", "recipe", "portIndices"], groupPath);
				return Object.freeze({
					kind: "EQ" as const,
					pitchMillimeters: expectInteger(group.pitchMillimeters, `${groupPath}.pitchMillimeters`),
					recipe: group.recipe === null ? null : expectString(group.recipe, `${groupPath}.recipe`),
					portIndices,
				});
			}
			expectExactKeys(group, ["kind", "template", "portIndices"], groupPath);
			return Object.freeze({
				kind: "STK" as const,
				template: expectEnum(group.template, STK_AUTHORING_TEMPLATES, `${groupPath}.template`) as
					| "FLEX"
					| "FOUR_PORT"
					| "SIX_PORT"
					| "BACK_TO_BACK",
				portIndices,
			});
		}),
	);
}

function validateBlueprintPortIndices(value: unknown, path: string): readonly number[] {
	const raw = expectArray(value, path);
	const seen = new Set<number>();
	const indices = raw.map((entry, index) => {
		const parsed = expectSafeNonNegativeInteger(entry, `${path}[${index}]`);
		if (seen.has(parsed)) fail("DUPLICATE_VALUE", `${path}[${index}]`, "duplicate port index");
		seen.add(parsed);
		return parsed;
	});
	return Object.freeze(indices);
}

function validateStaticFabBlueprintLayout(
	edges: readonly OpenFabBlueprintEdgeTuple[],
	ports: readonly OpenFabStaticFabBlueprintPort[],
	groups: readonly OpenFabStaticFabBlueprintEquipmentGroup[],
	path: string,
): void {
	const map = blueprintMapFromEdges(edges);
	const claimedPortIndices = new Set<number>();
	const portRecords = ports.map((port, index) => {
		if (port.equipmentGroupIndex >= groups.length) {
			fail(
				"INVALID_PORT_EQUIPMENT",
				`${path}.ports[${index}].equipmentGroupIndex`,
				"portable port references a missing equipment group",
			);
		}
		const from = openFabBlueprintDirectionToRail(port.route.from);
		const to = openFabBlueprintDirectionToRail(port.route.to);
		if (to !== oppositeDirection(from)) {
			fail(
				"INVALID_PORT_EQUIPMENT",
				`${path}.ports[${index}].route`,
				"static FAB blueprint ports must use cardinal straight through routes",
			);
		}
		return Object.freeze({
			id: index + 1,
			equipmentGroupId: port.equipmentGroupIndex + 1,
			route: Object.freeze({
				kind: "CARDINAL_CELL" as const,
				x: port.route.cell[0],
				z: port.route.cell[1],
				from,
				to,
			}),
			stationMillimeters: port.stationMillimeters,
			side: port.side,
			lateralOffsetMillimeters: port.lateralOffsetMillimeters,
			direction: port.direction,
			portType: port.portType,
			barcode: null,
		});
	});
	const equipmentGroups: EquipmentGroupRecord[] = groups.map((group, groupIndex) => {
		const portIds = group.portIndices.map((portIndex) => {
			const port = ports[portIndex];
			if (!port) {
				fail(
					"INVALID_PORT_EQUIPMENT",
					`${path}.equipmentGroups[${groupIndex}].portIndices`,
					"equipment group references a missing portable port",
				);
			}
			if (claimedPortIndices.has(portIndex)) {
				fail(
					"DUPLICATE_VALUE",
					`${path}.equipmentGroups[${groupIndex}].portIndices`,
					"portable port is owned by more than one equipment group",
				);
			}
			claimedPortIndices.add(portIndex);
			if (port.equipmentGroupIndex !== groupIndex || port.portType !== group.kind) {
				fail(
					"INVALID_PORT_EQUIPMENT",
					`${path}.equipmentGroups[${groupIndex}].portIndices`,
					"portable port ownership or type does not match its equipment group",
				);
			}
			return portIndex + 1;
		});
		if (group.kind === "OHB") {
			return Object.freeze({
				id: groupIndex + 1,
				kind: "OHB" as const,
				template: "SINGLE" as const,
				portIds,
			});
		}
		if (group.kind === "EQ") {
			return Object.freeze({
				id: groupIndex + 1,
				kind: "EQ" as const,
				pitchMillimeters: group.pitchMillimeters,
				recipe: group.recipe,
				portIds,
			});
		}
		return Object.freeze({
			id: groupIndex + 1,
			kind: "STK" as const,
			template: group.template,
			portIds,
		});
	});
	if (claimedPortIndices.size !== ports.length) {
		fail(
			"INVALID_PORT_EQUIPMENT",
			`${path}.ports`,
			"every portable port must be owned by exactly one equipment group",
		);
	}
	for (let groupIndex = 0; groupIndex < equipmentGroups.length; groupIndex++) {
		const group = equipmentGroups[groupIndex] as EquipmentGroupRecord;
		const error = equipmentGroupError(group);
		if (error) fail("INVALID_PORT_EQUIPMENT", `${path}.equipmentGroups[${groupIndex}]`, error);
		if (group.kind === "STK") {
			const analysis = analyzeStkPortLayout(
				group.portIds.map((portId) => {
					const port = portRecords[portId - 1];
					if (!port) throw new Error("validated portable STK port is missing");
					return {
						id: port.id,
						x: port.route.x,
						z: port.route.z,
						from: port.route.from,
						to: port.route.to,
						side: port.side,
						lateralOffsetMillimeters: port.lateralOffsetMillimeters,
						direction: port.direction,
					};
				}),
				group.template,
			);
			if (!analysis.valid) {
				fail("INVALID_PORT_EQUIPMENT", `${path}.equipmentGroups[${groupIndex}]`, analysis.reason);
			}
		}
	}
	try {
		assertPortEquipmentLayout(map, {
			nextPortId: portRecords.length + 1,
			nextEquipmentGroupId: equipmentGroups.length + 1,
			ports: portRecords,
			equipmentGroups,
		});
	} catch (error) {
		fail(
			"INVALID_PORT_EQUIPMENT",
			path,
			error instanceof Error ? error.message : "static FAB blueprint equipment layout is invalid",
		);
	}
	const spacingError = staticFabPortSpacingConflict([], portRecords);
	if (spacingError) fail("INVALID_PORT_EQUIPMENT", `${path}.ports`, spacingError);
}

function blueprintMapFromEdges(edges: readonly OpenFabBlueprintEdgeTuple[]): TileMap {
	const cells = new Map<
		string,
		{ readonly x: number; readonly z: number; incoming: number; outgoing: number }
	>();
	for (const [fromX, fromZ, toX, toZ] of edges) {
		const direction = toX === fromX + 1 ? 2 : toX === fromX - 1 ? 8 : toZ === fromZ + 1 ? 4 : 1;
		const fromKey = coordinateKey(fromX, fromZ);
		const toKey = coordinateKey(toX, toZ);
		const from = cells.get(fromKey) ?? { x: fromX, z: fromZ, incoming: 0, outgoing: 0 };
		const to = cells.get(toKey) ?? { x: toX, z: toZ, incoming: 0, outgoing: 0 };
		from.outgoing |= direction;
		to.incoming |= oppositeDirection(direction);
		cells.set(fromKey, from);
		cells.set(toKey, to);
	}
	const map = new TileMap();
	for (const cell of cells.values()) {
		map.setEncoded(
			cell.x,
			cell.z,
			encodeRailCell({ incoming: cell.incoming, outgoing: cell.outgoing }),
		);
	}
	return map;
}

function openFabBlueprintDirectionToRail(direction: OpenFabProjectDirection): 1 | 2 | 4 | 8 {
	if (direction === "N") return 1;
	if (direction === "E") return 2;
	if (direction === "S") return 4;
	return 8;
}

function validateBlueprintEdges(
	value: unknown,
	path: string,
	widthMeters: number,
	heightMeters: number,
): readonly OpenFabBlueprintEdgeTuple[] {
	const rawEdges = expectArray(value, `${path}.edges`);
	if (rawEdges.length === 0 || rawEdges.length > OPENFAB_BLUEPRINT_MAX_EDGES_PER_RECORD) {
		fail(
			"LIMIT_EXCEEDED",
			`${path}.edges`,
			`rail-area blueprint must contain 1-${OPENFAB_BLUEPRINT_MAX_EDGES_PER_RECORD} edges`,
		);
	}
	const edgeKeys = new Set<string>();
	const cells = new Map<
		string,
		{ readonly x: number; readonly z: number; incoming: number; outgoing: number }
	>();
	let minimumX = Number.POSITIVE_INFINITY;
	let minimumZ = Number.POSITIVE_INFINITY;
	let maximumX = Number.NEGATIVE_INFINITY;
	let maximumZ = Number.NEGATIVE_INFINITY;
	const edges = rawEdges.map((value, index) => {
		const edgePath = `${path}.edges[${index}]`;
		const tuple = expectArray(value, edgePath);
		if (tuple.length !== 4)
			fail("INVALID_FIELD", edgePath, "edge must be [fromX, fromZ, toX, toZ]");
		const edge = Object.freeze([
			expectInt32(tuple[0], `${edgePath}[0]`),
			expectInt32(tuple[1], `${edgePath}[1]`),
			expectInt32(tuple[2], `${edgePath}[2]`),
			expectInt32(tuple[3], `${edgePath}[3]`),
		] as const);
		const deltaX = edge[2] - edge[0];
		const deltaZ = edge[3] - edge[1];
		if (Math.abs(deltaX) + Math.abs(deltaZ) !== 1) {
			fail("INVALID_RAIL", edgePath, "blueprint edges must join adjacent cardinal cells");
		}
		for (const coordinate of [edge[0], edge[2]]) {
			if (coordinate < 0 || coordinate > widthMeters) {
				fail("INVALID_RAIL", edgePath, "blueprint x coordinate is outside its normalized bounds");
			}
		}
		for (const coordinate of [edge[1], edge[3]]) {
			if (coordinate < 0 || coordinate > heightMeters) {
				fail("INVALID_RAIL", edgePath, "blueprint z coordinate is outside its normalized bounds");
			}
		}
		const edgeKey = edge.join(",");
		if (edgeKeys.has(edgeKey)) fail("DUPLICATE_VALUE", edgePath, "duplicate blueprint edge");
		edgeKeys.add(edgeKey);
		minimumX = Math.min(minimumX, edge[0], edge[2]);
		minimumZ = Math.min(minimumZ, edge[1], edge[3]);
		maximumX = Math.max(maximumX, edge[0], edge[2]);
		maximumZ = Math.max(maximumZ, edge[1], edge[3]);
		const direction = deltaX === 1 ? 2 : deltaX === -1 ? 8 : deltaZ === 1 ? 4 : 1;
		const reciprocal = oppositeDirection(direction);
		const fromKey = coordinateKey(edge[0], edge[1]);
		const toKey = coordinateKey(edge[2], edge[3]);
		const from = cells.get(fromKey) ?? { x: edge[0], z: edge[1], incoming: 0, outgoing: 0 };
		const to = cells.get(toKey) ?? { x: edge[2], z: edge[3], incoming: 0, outgoing: 0 };
		from.outgoing |= direction;
		to.incoming |= reciprocal;
		cells.set(fromKey, from);
		cells.set(toKey, to);
		return edge;
	});
	if (minimumX !== 0 || minimumZ !== 0 || maximumX !== widthMeters || maximumZ !== heightMeters) {
		fail(
			"INVALID_RAIL",
			`${path}.edges`,
			"blueprint geometry must exactly fill its normalized bounds",
		);
	}
	for (const [key, cell] of cells) {
		if (
			(cell.incoming & cell.outgoing) !== 0 ||
			bitCount(cell.incoming | cell.outgoing) > 3 ||
			classifyRailCell(cell) === "INVALID"
		) {
			fail(
				"INVALID_RAIL",
				`${path}.edges(${key})`,
				"blueprint rail contains an invalid directed junction",
			);
		}
	}
	edges.sort(compareOpenFabBlueprintEdgeTuples);
	return Object.freeze(edges);
}

function expectBlueprintLabel(
	value: unknown,
	path: string,
	maximumLength: number,
	allowEmpty: boolean,
): string {
	const label = expectString(value, path);
	if (
		(!allowEmpty && label.length === 0) ||
		label.length > maximumLength ||
		label !== label.trim() ||
		containsAsciiControlCharacter(label)
	) {
		fail("INVALID_FIELD", path, `label must be a trimmed 1-${maximumLength} character value`);
	}
	return label;
}

function expectBlueprintFolder(value: unknown, path: string): string {
	const folder = expectBlueprintLabel(value, path, 160, true);
	if (folder === "") return folder;
	const segments = folder.split("/");
	if (
		segments.length > 4 ||
		segments.some(
			(segment) =>
				segment.length === 0 ||
				segment.length > 40 ||
				segment === "." ||
				segment === ".." ||
				segment !== segment.trim(),
		)
	) {
		fail("INVALID_FIELD", path, "folder must contain up to four non-empty path segments");
	}
	return folder;
}

function validateOrganizationSection(value: unknown): OpenFabProjectOrganizationSection {
	const path = "$.areas";
	const section = expectRecord(value, path);
	expectExactKeys(section, ["schemaVersion", "nextOrganizationId", "records"], path);
	expectLiteral(
		section.schemaVersion,
		OPENFAB_ORGANIZATION_SECTION_SCHEMA_VERSION,
		`${path}.schemaVersion`,
	);
	const nextOrganizationId = expectPositiveInt32(
		section.nextOrganizationId,
		`${path}.nextOrganizationId`,
	);
	const rawRecords = expectArray(section.records, `${path}.records`);
	if (rawRecords.length > OPENFAB_PROJECT_MAX_ORGANIZATIONS) {
		fail(
			"LIMIT_EXCEEDED",
			`${path}.records`,
			`organization count exceeds ${OPENFAB_PROJECT_MAX_ORGANIZATIONS}`,
		);
	}
	const ids = new Set<number>();
	let maximumId = 0;
	let totalEdges = 0;
	const records = rawRecords.map((value, index) => {
		const recordPath = `${path}.records[${index}]`;
		const record = expectRecord(value, recordPath);
		expectExactKeys(
			record,
			["id", "kind", "name", "parentOrganizationIds", "properties", "membership"],
			recordPath,
		);
		const id = expectPositiveInt32(record.id, `${recordPath}.id`);
		if (ids.has(id)) fail("DUPLICATE_VALUE", `${recordPath}.id`, `duplicate organization id ${id}`);
		ids.add(id);
		maximumId = Math.max(maximumId, id);
		const kind = expectEnum(record.kind, STATIC_FAB_ORGANIZATION_KINDS, `${recordPath}.kind`);
		const name = expectString(record.name, `${recordPath}.name`);
		if (
			name.length === 0 ||
			name.length > 120 ||
			name !== name.trim() ||
			containsAsciiControlCharacter(name)
		) {
			fail(
				"INVALID_ORGANIZATION",
				`${recordPath}.name`,
				"organization name must be a trimmed 1-120 character label",
			);
		}
		const parentOrganizationIds = validateCanonicalPositiveIds(
			record.parentOrganizationIds,
			`${recordPath}.parentOrganizationIds`,
		);
		if (parentOrganizationIds.length > STATIC_FAB_ORGANIZATION_MAX_PARENTS) {
			fail(
				"LIMIT_EXCEEDED",
				`${recordPath}.parentOrganizationIds`,
				`organization parent count exceeds ${STATIC_FAB_ORGANIZATION_MAX_PARENTS}`,
			);
		}
		if (parentOrganizationIds.includes(id)) {
			fail(
				"INVALID_ORGANIZATION",
				`${recordPath}.parentOrganizationIds`,
				"organization cannot parent itself",
			);
		}
		const rawProperties = expectRecord(record.properties, `${recordPath}.properties`);
		expectExactKeys(rawProperties, ["description", "color"], `${recordPath}.properties`);
		const description = expectString(
			rawProperties.description,
			`${recordPath}.properties.description`,
		);
		if (
			description.length > STATIC_FAB_ORGANIZATION_MAX_DESCRIPTION_LENGTH ||
			description !== description.trim() ||
			containsDisallowedOrganizationDescriptionControl(description)
		) {
			fail(
				"INVALID_ORGANIZATION",
				`${recordPath}.properties.description`,
				`organization description must be trimmed and at most ${STATIC_FAB_ORGANIZATION_MAX_DESCRIPTION_LENGTH} characters`,
			);
		}
		const color = expectEnum(
			rawProperties.color,
			STATIC_FAB_ORGANIZATION_COLORS,
			`${recordPath}.properties.color`,
		);
		const membership = expectRecord(record.membership, `${recordPath}.membership`);
		expectExactKeys(
			membership,
			["railEdges", "advancedSwitchIds", "equipmentGroupIds"],
			`${recordPath}.membership`,
		);
		const rawEdges = expectArray(membership.railEdges, `${recordPath}.membership.railEdges`);
		totalEdges += rawEdges.length;
		if (totalEdges > OPENFAB_PROJECT_MAX_ORGANIZATION_EDGES) {
			fail(
				"LIMIT_EXCEEDED",
				`${path}.records`,
				`organization edge total exceeds ${OPENFAB_PROJECT_MAX_ORGANIZATION_EDGES}`,
			);
		}
		const railEdges = rawEdges.map((rawEdge, edgeIndex) => {
			const edgePath = `${recordPath}.membership.railEdges[${edgeIndex}]`;
			const tuple = expectArray(rawEdge, edgePath);
			if (tuple.length !== 4) {
				fail(
					"INVALID_ORGANIZATION",
					edgePath,
					"organization edge must be [fromX, fromZ, toX, toZ]",
				);
			}
			const edge = Object.freeze([
				expectInt32(tuple[0], `${edgePath}[0]`),
				expectInt32(tuple[1], `${edgePath}[1]`),
				expectInt32(tuple[2], `${edgePath}[2]`),
				expectInt32(tuple[3], `${edgePath}[3]`),
			] as const) satisfies OpenFabOrganizationRailEdgeTuple;
			if (Math.abs(edge[2] - edge[0]) + Math.abs(edge[3] - edge[1]) !== 1) {
				fail(
					"INVALID_ORGANIZATION",
					edgePath,
					"organization edge must join adjacent cardinal cells",
				);
			}
			return edge;
		});
		for (let edgeIndex = 1; edgeIndex < railEdges.length; edgeIndex++) {
			const previousEdge = railEdges[edgeIndex - 1];
			const currentEdge = railEdges[edgeIndex];
			if (
				previousEdge === undefined ||
				currentEdge === undefined ||
				compareOrganizationEdgeTuples(previousEdge, currentEdge) >= 0
			) {
				fail(
					"INVALID_ORGANIZATION",
					`${recordPath}.membership.railEdges[${edgeIndex}]`,
					"organization edges must be unique and canonically ordered",
				);
			}
		}
		const advancedSwitchIds = validateCanonicalPositiveIds(
			membership.advancedSwitchIds,
			`${recordPath}.membership.advancedSwitchIds`,
		);
		const equipmentGroupIds = validateCanonicalPositiveIds(
			membership.equipmentGroupIds,
			`${recordPath}.membership.equipmentGroupIds`,
		);
		if (railEdges.length + advancedSwitchIds.length + equipmentGroupIds.length === 0) {
			fail(
				"INVALID_ORGANIZATION",
				`${recordPath}.membership`,
				"organization membership cannot be empty",
			);
		}
		return Object.freeze({
			id,
			kind,
			name,
			parentOrganizationIds,
			properties: Object.freeze({ description, color }),
			membership: Object.freeze({
				railEdges: Object.freeze(railEdges),
				advancedSwitchIds,
				equipmentGroupIds,
			}),
		}) satisfies OpenFabProjectOrganizationRecord;
	});
	records.sort((left, right) => left.id - right.id);
	if (nextOrganizationId <= maximumId) {
		fail(
			"INVALID_ORGANIZATION",
			`${path}.nextOrganizationId`,
			"organization cursor must exceed every persisted organization id",
		);
	}
	return Object.freeze({
		schemaVersion: OPENFAB_ORGANIZATION_SECTION_SCHEMA_VERSION,
		nextOrganizationId,
		records: Object.freeze(records),
	});
}

function migrateOrganizationSectionV1(value: unknown): OpenFabProjectOrganizationSection {
	const path = "$.areas";
	const section = expectRecord(value, path);
	expectExactKeys(section, ["schemaVersion", "nextOrganizationId", "records"], path);
	expectLiteral(section.schemaVersion, 1, `${path}.schemaVersion`);
	const records = expectArray(section.records, `${path}.records`).map((value, index) => {
		const recordPath = `${path}.records[${index}]`;
		const record = expectRecord(value, recordPath);
		expectExactKeys(record, ["id", "kind", "name", "membership"], recordPath);
		return {
			...record,
			parentOrganizationIds: [],
			properties: { description: "", color: "TEAL" },
		};
	});
	return validateOrganizationSection({
		schemaVersion: OPENFAB_ORGANIZATION_SECTION_SCHEMA_VERSION,
		nextOrganizationId: section.nextOrganizationId,
		records,
	});
}

function validateRelationshipSection(value: unknown): OpenFabProjectRelationshipSection {
	const path = "$.relationships";
	const section = expectRecord(value, path);
	expectExactKeys(section, ["schemaVersion", "nextRelationshipId", "records"], path);
	expectLiteral(
		section.schemaVersion,
		OPENFAB_RELATIONSHIP_SECTION_SCHEMA_VERSION,
		`${path}.schemaVersion`,
	);
	try {
		const state = createStaticFabAssemblyRelationshipState({
			nextRelationshipId: section.nextRelationshipId,
			records: section.records,
		});
		return Object.freeze({
			schemaVersion: OPENFAB_RELATIONSHIP_SECTION_SCHEMA_VERSION,
			nextRelationshipId: state.nextRelationshipId,
			records: state.records,
		});
	} catch (error) {
		fail(
			"INVALID_RELATIONSHIP",
			path,
			error instanceof Error ? error.message : "invalid assembly relationship state",
		);
	}
}

function containsDisallowedOrganizationDescriptionControl(value: string): boolean {
	for (let index = 0; index < value.length; index++) {
		const code = value.charCodeAt(index);
		if ((code <= 0x1f && code !== 0x09 && code !== 0x0a) || code === 0x7f) return true;
	}
	return false;
}

function validateOrganizations(project: OpenFabProjectAuthoredSource): {
	readonly map: TileMap;
	readonly organizations: StaticFabOrganizationState;
} {
	const hydrator = TileMap.createHydrator();
	for (const [x, z, encoded] of project.rail.cells) hydrator.addEncodedCell(x, z, encoded);
	for (const persisted of project.rail.advancedSwitches) {
		hydrator.addAdvancedSwitch(openFabAdvancedSwitchToRecord(persisted));
	}
	const map = hydrator.finish(project.rail.revision, project.rail.nextAdvancedSwitchId);
	let organizations: StaticFabOrganizationState;
	try {
		organizations = createStaticFabOrganizationStateFromOpenFabProjectSection(project.areas);
	} catch (error) {
		fail(
			"INVALID_ORGANIZATION",
			"$.areas",
			error instanceof Error ? error.message : "invalid organization relationship graph",
		);
	}
	const error = staticFabOrganizationStateError(
		map,
		{
			nextPortId: project.ports.nextPortId,
			nextEquipmentGroupId: project.equipment.nextEquipmentGroupId,
			ports: project.ports.records.map(openFabProjectPortToRecord),
			equipmentGroups: project.equipment.records,
		},
		organizations,
	);
	if (error) fail("INVALID_ORGANIZATION", "$.areas", error);
	return Object.freeze({ map, organizations });
}

function validateRelationships(
	project: OpenFabProject,
	map: TileMap,
	organizations: StaticFabOrganizationState,
): void {
	const relationships = {
		nextRelationshipId: project.relationships.nextRelationshipId,
		records: project.relationships.records,
	};
	const error = staticFabAssemblyRelationshipStateSourceError(map, organizations, relationships);
	if (error) fail("INVALID_RELATIONSHIP", "$.relationships", error);
}

function validateCanonicalPositiveIds(value: unknown, path: string): readonly number[] {
	const raw = expectArray(value, path);
	const ids = raw.map((id, index) => expectPositiveInt32(id, `${path}[${index}]`));
	for (let index = 1; index < ids.length; index++) {
		if ((ids[index - 1] as number) >= (ids[index] as number)) {
			fail(
				"INVALID_ORGANIZATION",
				`${path}[${index}]`,
				"organization IDs must be unique and canonically ordered",
			);
		}
	}
	return Object.freeze(ids);
}

function compareOrganizationEdgeTuples(
	left: OpenFabOrganizationRailEdgeTuple,
	right: OpenFabOrganizationRailEdgeTuple,
): number {
	return left[0] - right[0] || left[1] - right[1] || left[2] - right[2] || left[3] - right[3];
}

function validateReservedSection(value: unknown, path: string): OpenFabProjectReservedSection {
	const section = expectRecord(value, path);
	expectExactKeys(section, ["schemaVersion", "records"], path);
	expectLiteral(
		section.schemaVersion,
		OPENFAB_RESERVED_SECTION_SCHEMA_VERSION,
		`${path}.schemaVersion`,
	);
	const records = expectArray(section.records, `${path}.records`);
	if (records.length !== 0) {
		fail(
			"UNSUPPORTED_VERSION",
			`${path}.records`,
			"records are gated until this section has a schema",
		);
	}
	return emptyReservedSection();
}

function validateView(value: unknown): OpenFabProjectView {
	const view = expectRecord(value, "$.view");
	expectExactKeys(
		view,
		["center", "zoomPixelsPerMeter", "quarterTurns", "railPresentation"],
		"$.view",
	);
	const center = expectArray(view.center, "$.view.center");
	if (center.length !== 2) fail("INVALID_FIELD", "$.view.center", "view center must be [x, z]");
	const centerX = expectFiniteNumber(center[0], "$.view.center[0]");
	const centerZ = expectFiniteNumber(center[1], "$.view.center[1]");
	if (Math.abs(centerX) > 0x7fffffff || Math.abs(centerZ) > 0x7fffffff) {
		fail("INVALID_FIELD", "$.view.center", "view center is outside the authored coordinate domain");
	}
	const zoomPixelsPerMeter = expectFiniteNumber(
		view.zoomPixelsPerMeter,
		"$.view.zoomPixelsPerMeter",
	);
	if (
		zoomPixelsPerMeter < OPENFAB_PROJECT_VIEW_MIN_ZOOM_PIXELS_PER_METER ||
		zoomPixelsPerMeter > OPENFAB_PROJECT_VIEW_MAX_ZOOM_PIXELS_PER_METER
	) {
		fail(
			"INVALID_FIELD",
			"$.view.zoomPixelsPerMeter",
			`zoom must be between ${OPENFAB_PROJECT_VIEW_MIN_ZOOM_PIXELS_PER_METER} and ${OPENFAB_PROJECT_VIEW_MAX_ZOOM_PIXELS_PER_METER}`,
		);
	}
	const quarterTurns = expectInteger(view.quarterTurns, "$.view.quarterTurns");
	if (quarterTurns < 0 || quarterTurns > 3) {
		fail("INVALID_FIELD", "$.view.quarterTurns", "view rotation must be 0, 1, 2, or 3");
	}
	const railPresentation = expectString(view.railPresentation, "$.view.railPresentation");
	if (railPresentation !== "profiled" && railPresentation !== "diagnostic") {
		fail("INVALID_FIELD", "$.view.railPresentation", "unknown rail presentation mode");
	}
	return Object.freeze({
		center: Object.freeze([centerX, centerZ] as const),
		zoomPixelsPerMeter,
		quarterTurns: quarterTurns as OpenFabProjectQuarterTurns,
		railPresentation: railPresentation as OpenFabProjectRailPresentation,
	});
}

function emptyReservedSection(): OpenFabProjectReservedSection {
	return Object.freeze({
		schemaVersion: OPENFAB_RESERVED_SECTION_SCHEMA_VERSION,
		records: Object.freeze([]),
	});
}

function emptyPortSection(): OpenFabProjectPortSection {
	return Object.freeze({
		schemaVersion: OPENFAB_PORT_SECTION_SCHEMA_VERSION,
		nextPortId: 1,
		records: Object.freeze([]),
	});
}

function emptyEquipmentSection(): OpenFabProjectEquipmentSection {
	return Object.freeze({
		schemaVersion: OPENFAB_EQUIPMENT_SECTION_SCHEMA_VERSION,
		nextEquipmentGroupId: 1,
		records: Object.freeze([]),
	});
}

function expectCanonicalTimestamp(value: unknown, path: string): string {
	const timestamp = expectString(value, path);
	if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(timestamp)) {
		fail("INVALID_FIELD", path, "timestamp must be a canonical UTC ISO-8601 value");
	}
	const milliseconds = Date.parse(timestamp);
	if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== timestamp) {
		fail("INVALID_FIELD", path, "timestamp is not a real canonical UTC instant");
	}
	return timestamp;
}

function expectProjectDirection(value: unknown, path: string): OpenFabProjectDirection {
	const direction = expectString(value, path);
	if (!OPENFAB_PROJECT_DIRECTION_NAMES.includes(direction as OpenFabProjectDirection)) {
		fail("INVALID_FIELD", path, "direction must be N, E, S, or W");
	}
	return direction as OpenFabProjectDirection;
}

function expectNullableProjectDirection(
	value: unknown,
	path: string,
): OpenFabProjectDirection | null {
	return value === null ? null : expectProjectDirection(value, path);
}

function expectRecord(
	value: unknown,
	path: string,
	code: OpenFabProjectParseErrorCode = "INVALID_FIELD",
): Readonly<Record<string, unknown>> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		fail(code, path, "expected an object");
	}
	return value as Readonly<Record<string, unknown>>;
}

function expectArray(value: unknown, path: string): readonly unknown[] {
	if (!Array.isArray(value)) fail("INVALID_FIELD", path, "expected an array");
	return value;
}

function expectString(value: unknown, path: string): string {
	if (typeof value !== "string") fail("INVALID_FIELD", path, "expected a string");
	return value;
}

function expectInteger(value: unknown, path: string): number {
	if (!Number.isInteger(value)) fail("INVALID_FIELD", path, "expected an integer");
	return value as number;
}

function expectSafeNonNegativeInteger(value: unknown, path: string): number {
	const integer = expectInteger(value, path);
	if (!Number.isSafeInteger(integer) || integer < 0) {
		fail("INVALID_FIELD", path, "expected a non-negative safe integer");
	}
	return integer;
}

function expectInt32(value: unknown, path: string): number {
	const integer = expectInteger(value, path);
	if (integer < -0x80000000 || integer > 0x7fffffff) {
		fail("INVALID_FIELD", path, "coordinate is outside signed int32");
	}
	return integer;
}

function expectPositiveInt32(value: unknown, path: string): number {
	const integer = expectInteger(value, path);
	if (integer <= 0 || integer > 0x7fffffff) {
		fail("INVALID_FIELD", path, "expected a positive signed int32");
	}
	return integer;
}

function expectIdCursor(value: unknown, path: string): number {
	const integer = expectInteger(value, path);
	if (integer < 1 || integer > 0x8000_0000) {
		fail("INVALID_FIELD", path, "expected an ID cursor from 1 through signed-int32 max plus one");
	}
	return integer;
}

function expectFiniteNumber(value: unknown, path: string): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		fail("INVALID_FIELD", path, "expected a finite number");
	}
	return value;
}

function expectLiteral(value: unknown, expected: string | number, path: string): void {
	if (value !== expected) fail("INVALID_FIELD", path, `expected ${String(expected)}`);
}

function expectLiteralValue<T extends string | number>(
	value: unknown,
	expected: T,
	path: string,
): T {
	expectLiteral(value, expected, path);
	return expected;
}

function expectEnum<const T extends readonly string[]>(
	value: unknown,
	values: T,
	path: string,
): T[number] {
	const parsed = expectString(value, path);
	if (!values.includes(parsed)) fail("INVALID_FIELD", path, `expected one of ${values.join(", ")}`);
	return parsed as T[number];
}

function expectExactKeys(
	value: Readonly<Record<string, unknown>>,
	expected: readonly string[],
	path: string,
): void {
	const expectedKeys = new Set(expected);
	for (const key of Object.keys(value)) {
		if (!expectedKeys.has(key)) fail("INVALID_FIELD", `${path}.${key}`, "unknown field");
	}
	for (const key of expected) {
		if (!Object.hasOwn(value, key)) fail("INVALID_FIELD", `${path}.${key}`, "missing field");
	}
}

function sortJsonObjectKeys(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortJsonObjectKeys);
	if (typeof value !== "object" || value === null) return value;
	const source = value as Readonly<Record<string, unknown>>;
	const sorted: Record<string, unknown> = {};
	for (const key of Object.keys(source).sort()) sorted[key] = sortJsonObjectKeys(source[key]);
	return sorted;
}

function compareCells(left: OpenFabRailCellTuple, right: OpenFabRailCellTuple): number {
	return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
}

function coordinateKey(x: number, z: number): string {
	return `${x},${z}`;
}

function containsAsciiControlCharacter(value: string): boolean {
	for (let index = 0; index < value.length; index++) {
		if (value.charCodeAt(index) < 0x20) return true;
	}
	return false;
}

function fail(code: OpenFabProjectParseErrorCode, path: string, message: string): never {
	throw new OpenFabProjectParseError(code, path, message);
}
