import {
	RAIL_AREA_STAMP_MAX_EDGES,
	type RailAreaStampEdge,
	type RailAreaStampTemplate,
} from "../core/RailAreaStamp";
import { DIR_E, DIR_N, DIR_S, DIR_W, type Direction } from "../core/railShape";
import {
	STATIC_FAB_BLUEPRINT_MAX_EQUIPMENT_GROUPS,
	STATIC_FAB_BLUEPRINT_MAX_PORTS,
	type StaticFabBlueprintEquipmentGroupTemplate,
	type StaticFabBlueprintPortTemplate,
	type StaticFabBlueprintTemplate,
} from "../core/StaticFabBlueprint";
import {
	prepareStaticFabOrganizationBundle,
	type StaticFabOrganizationBundle,
} from "../core/StaticFabOrganizationBundle";

export const OPENFAB_BLUEPRINT_SECTION_SCHEMA_VERSION = 4 as const;
export const OPENFAB_BLUEPRINT_KIND_RAIL_AREA = "RAIL_AREA" as const;
export const OPENFAB_BLUEPRINT_KIND_STATIC_FAB = "STATIC_FAB" as const;
export const OPENFAB_BLUEPRINT_KIND_STATIC_FAB_ORGANIZATION = "STATIC_FAB_ORGANIZATION" as const;
export const OPENFAB_BLUEPRINT_MAX_RECORDS = 256;
export const OPENFAB_BLUEPRINT_MAX_EDGES_PER_RECORD = RAIL_AREA_STAMP_MAX_EDGES;
export const OPENFAB_BLUEPRINT_MAX_TOTAL_EDGES = 100_000;

export type OpenFabBlueprintEdgeTuple = readonly [
	fromX: number,
	fromZ: number,
	toX: number,
	toZ: number,
];

export type OpenFabBlueprintDirection = "N" | "E" | "S" | "W";

export interface OpenFabBlueprintCardinalPortRoute {
	readonly kind: "CARDINAL_CELL";
	readonly cell: readonly [x: number, z: number];
	readonly from: OpenFabBlueprintDirection;
	readonly to: OpenFabBlueprintDirection;
}

/** Portable port truth. It intentionally has no runtime port ID or barcode. */
export interface OpenFabStaticFabBlueprintPort {
	readonly equipmentGroupIndex: number;
	readonly route: OpenFabBlueprintCardinalPortRoute;
	readonly stationMillimeters: number;
	readonly side: "CENTER" | "LEFT" | "RIGHT";
	readonly lateralOffsetMillimeters: number;
	readonly direction: "WITH_TRAVEL" | "AGAINST_TRAVEL";
	readonly portType: "OHB" | "EQ" | "STK";
}

export type OpenFabStaticFabBlueprintEquipmentGroup =
	| {
			readonly kind: "OHB";
			readonly template: "SINGLE";
			readonly portIndices: readonly number[];
	  }
	| {
			readonly kind: "EQ";
			readonly pitchMillimeters: number;
			readonly recipe: string | null;
			readonly portIndices: readonly number[];
	  }
	| {
			readonly kind: "STK";
			readonly template: "FLEX" | "FOUR_PORT" | "SIX_PORT" | "BACK_TO_BACK";
			readonly portIndices: readonly number[];
	  };

interface OpenFabBlueprintRecordBase {
	readonly id: string;
	readonly name: string;
	readonly folder: string;
	readonly favorite: boolean;
	readonly createdAt: string;
	readonly updatedAt: string;
	readonly sourceModuleCount: number;
	readonly widthMeters: number;
	readonly heightMeters: number;
	readonly edges: readonly OpenFabBlueprintEdgeTuple[];
}

export interface OpenFabRailAreaBlueprint extends OpenFabBlueprintRecordBase {
	readonly kind: typeof OPENFAB_BLUEPRINT_KIND_RAIL_AREA;
}

export interface OpenFabStaticFabBlueprint extends OpenFabBlueprintRecordBase {
	readonly kind: typeof OPENFAB_BLUEPRINT_KIND_STATIC_FAB;
	readonly ports: readonly OpenFabStaticFabBlueprintPort[];
	readonly equipmentGroups: readonly OpenFabStaticFabBlueprintEquipmentGroup[];
}

/**
 * Organization blueprints keep the portable bundle as authored truth. The inherited rail summary is
 * an exact, codec-verified projection retained for the existing library thumbnail contract.
 */
export interface OpenFabStaticFabOrganizationBlueprint extends OpenFabBlueprintRecordBase {
	readonly kind: typeof OPENFAB_BLUEPRINT_KIND_STATIC_FAB_ORGANIZATION;
	readonly bundle: StaticFabOrganizationBundle;
}

export type OpenFabProjectBlueprint =
	| OpenFabRailAreaBlueprint
	| OpenFabStaticFabBlueprint
	| OpenFabStaticFabOrganizationBlueprint;

export interface OpenFabProjectBlueprintSection {
	readonly schemaVersion: typeof OPENFAB_BLUEPRINT_SECTION_SCHEMA_VERSION;
	readonly records: readonly OpenFabProjectBlueprint[];
}

export interface CreateOpenFabRailAreaBlueprintOptions {
	readonly id: string;
	readonly name: string;
	readonly folder?: string;
	readonly favorite?: boolean;
	readonly createdAt: string;
}

export type CreateOpenFabStaticFabBlueprintOptions = CreateOpenFabRailAreaBlueprintOptions;
export type CreateOpenFabStaticFabOrganizationBlueprintOptions =
	CreateOpenFabRailAreaBlueprintOptions;

export function createEmptyOpenFabProjectBlueprintSection(): OpenFabProjectBlueprintSection {
	return Object.freeze({
		schemaVersion: OPENFAB_BLUEPRINT_SECTION_SCHEMA_VERSION,
		records: Object.freeze([]),
	});
}

export function createOpenFabRailAreaBlueprint(
	template: RailAreaStampTemplate,
	options: CreateOpenFabRailAreaBlueprintOptions,
): OpenFabRailAreaBlueprint {
	return Object.freeze({
		...createBlueprintRecordBase(template, options),
		kind: OPENFAB_BLUEPRINT_KIND_RAIL_AREA,
	});
}

export function createOpenFabStaticFabBlueprint(
	template: StaticFabBlueprintTemplate,
	options: CreateOpenFabStaticFabBlueprintOptions,
): OpenFabStaticFabBlueprint {
	return Object.freeze({
		...createBlueprintRecordBase(template.rail, options),
		kind: OPENFAB_BLUEPRINT_KIND_STATIC_FAB,
		ports: Object.freeze(template.ports.map(staticFabPortToOpenFab)),
		equipmentGroups: Object.freeze(template.equipmentGroups.map(copyStaticFabEquipmentGroup)),
	});
}

export function createOpenFabStaticFabOrganizationBlueprint(
	input: unknown,
	options: CreateOpenFabStaticFabOrganizationBlueprintOptions,
): OpenFabStaticFabOrganizationBlueprint {
	const bundle = prepareOrganizationBundleOrThrow(input);
	return Object.freeze({
		...createBlueprintRecordMetadata(options),
		kind: OPENFAB_BLUEPRINT_KIND_STATIC_FAB_ORGANIZATION,
		sourceModuleCount: bundle.sourceModuleCount,
		widthMeters: bundle.sourceWidthMeters,
		heightMeters: bundle.sourceHeightMeters,
		edges: organizationBundleEdgeTuples(bundle),
		bundle,
	});
}

export function compareOpenFabBlueprintEdgeTuples(
	left: OpenFabBlueprintEdgeTuple,
	right: OpenFabBlueprintEdgeTuple,
): number {
	return left[0] - right[0] || left[1] - right[1] || left[2] - right[2] || left[3] - right[3];
}

export function railAreaStampTemplateFromOpenFabBlueprint(
	record: OpenFabRailAreaBlueprint,
): RailAreaStampTemplate {
	return railAreaTemplateFromRecord(record);
}

export function staticFabBlueprintTemplateFromOpenFabBlueprint(
	record: OpenFabStaticFabBlueprint,
): StaticFabBlueprintTemplate {
	return Object.freeze({
		rail: railAreaTemplateFromRecord(record),
		ports: Object.freeze(record.ports.map(openFabPortToStaticFab)),
		equipmentGroups: Object.freeze(record.equipmentGroups.map(copyStaticFabEquipmentGroup)),
	});
}

export function copyOpenFabProjectBlueprintSection(
	section: OpenFabProjectBlueprintSection,
): OpenFabProjectBlueprintSection {
	return Object.freeze({
		schemaVersion: OPENFAB_BLUEPRINT_SECTION_SCHEMA_VERSION,
		records: Object.freeze(section.records.map(copyOpenFabProjectBlueprint)),
	});
}

export function copyOpenFabProjectBlueprint(
	record: OpenFabProjectBlueprint,
): OpenFabProjectBlueprint {
	const base = {
		id: record.id,
		kind: record.kind,
		name: record.name,
		folder: record.folder,
		favorite: record.favorite,
		createdAt: record.createdAt,
		updatedAt: record.updatedAt,
		sourceModuleCount: record.sourceModuleCount,
		widthMeters: record.widthMeters,
		heightMeters: record.heightMeters,
		edges: copyEdges(record.edges),
	};
	if (record.kind === OPENFAB_BLUEPRINT_KIND_RAIL_AREA) {
		return Object.freeze({ ...base, kind: OPENFAB_BLUEPRINT_KIND_RAIL_AREA });
	}
	if (record.kind === OPENFAB_BLUEPRINT_KIND_STATIC_FAB) {
		return Object.freeze({
			...base,
			kind: OPENFAB_BLUEPRINT_KIND_STATIC_FAB,
			ports: Object.freeze(record.ports.map(copyStaticFabPort)),
			equipmentGroups: Object.freeze(record.equipmentGroups.map(copyStaticFabEquipmentGroup)),
		});
	}
	const bundle = prepareOrganizationBundleOrThrow(record.bundle);
	return Object.freeze({
		...base,
		kind: OPENFAB_BLUEPRINT_KIND_STATIC_FAB_ORGANIZATION,
		sourceModuleCount: bundle.sourceModuleCount,
		widthMeters: bundle.sourceWidthMeters,
		heightMeters: bundle.sourceHeightMeters,
		edges: organizationBundleEdgeTuples(bundle),
		bundle,
	});
}

export function updateOpenFabProjectBlueprint(
	record: OpenFabProjectBlueprint,
	changes: Readonly<{
		name?: string;
		folder?: string;
		favorite?: boolean;
		updatedAt: string;
	}>,
): OpenFabProjectBlueprint {
	return Object.freeze({
		...record,
		name: changes.name ?? record.name,
		folder: changes.folder ?? record.folder,
		favorite: changes.favorite ?? record.favorite,
		updatedAt: changes.updatedAt,
		edges: record.edges,
		...(record.kind === OPENFAB_BLUEPRINT_KIND_STATIC_FAB
			? { ports: record.ports, equipmentGroups: record.equipmentGroups }
			: {}),
	});
}

function createBlueprintRecordBase(
	template: RailAreaStampTemplate,
	options: CreateOpenFabRailAreaBlueprintOptions,
): Omit<OpenFabBlueprintRecordBase, "kind"> {
	return Object.freeze({
		...createBlueprintRecordMetadata(options),
		sourceModuleCount: template.sourceModuleCount,
		widthMeters: template.sourceWidthMeters,
		heightMeters: template.sourceHeightMeters,
		edges: Object.freeze(
			template.edges.map(railAreaStampEdgeToTuple).sort(compareOpenFabBlueprintEdgeTuples),
		),
	});
}

function createBlueprintRecordMetadata(options: CreateOpenFabRailAreaBlueprintOptions) {
	return Object.freeze({
		id: options.id,
		name: options.name,
		folder: options.folder ?? "",
		favorite: options.favorite ?? false,
		createdAt: options.createdAt,
		updatedAt: options.createdAt,
	});
}

function railAreaTemplateFromRecord(record: OpenFabBlueprintRecordBase): RailAreaStampTemplate {
	return Object.freeze({
		sourceRevision: 0,
		sourceModuleKeys: Object.freeze([]),
		sourceModuleCount: record.sourceModuleCount,
		sourceEdgeCount: record.edges.length,
		sourceWidthMeters: record.widthMeters,
		sourceHeightMeters: record.heightMeters,
		edges: Object.freeze(record.edges.map(tupleToRailAreaStampEdge)),
	});
}

function staticFabPortToOpenFab(
	port: StaticFabBlueprintPortTemplate,
): OpenFabStaticFabBlueprintPort {
	if (port.route.from === 0 || port.route.to === 0) {
		throw new TypeError("Static FAB blueprint ports require cardinal through routes.");
	}
	return Object.freeze({
		equipmentGroupIndex: port.equipmentGroupIndex,
		route: Object.freeze({
			kind: "CARDINAL_CELL",
			cell: Object.freeze([port.route.x, port.route.z] as const),
			from: directionToOpenFab(port.route.from),
			to: directionToOpenFab(port.route.to),
		}),
		stationMillimeters: port.stationMillimeters,
		side: port.side,
		lateralOffsetMillimeters: port.lateralOffsetMillimeters,
		direction: port.direction,
		portType: port.portType,
	});
}

function openFabPortToStaticFab(
	port: OpenFabStaticFabBlueprintPort,
): StaticFabBlueprintPortTemplate {
	return Object.freeze({
		equipmentGroupIndex: port.equipmentGroupIndex,
		route: Object.freeze({
			kind: "CARDINAL_CELL",
			x: port.route.cell[0],
			z: port.route.cell[1],
			from: openFabToDirection(port.route.from),
			to: openFabToDirection(port.route.to),
		}),
		stationMillimeters: port.stationMillimeters,
		side: port.side,
		lateralOffsetMillimeters: port.lateralOffsetMillimeters,
		direction: port.direction,
		portType: port.portType,
	});
}

function copyStaticFabPort(port: OpenFabStaticFabBlueprintPort): OpenFabStaticFabBlueprintPort {
	return Object.freeze({
		...port,
		route: Object.freeze({
			...port.route,
			cell: Object.freeze([...port.route.cell] as [number, number]),
		}),
	});
}

function copyStaticFabEquipmentGroup(
	group: StaticFabBlueprintEquipmentGroupTemplate | OpenFabStaticFabBlueprintEquipmentGroup,
): OpenFabStaticFabBlueprintEquipmentGroup {
	if (group.kind === "OHB") {
		return Object.freeze({
			kind: "OHB",
			template: "SINGLE",
			portIndices: Object.freeze([...group.portIndices]),
		});
	}
	if (group.kind === "EQ") {
		return Object.freeze({
			kind: "EQ",
			pitchMillimeters: group.pitchMillimeters,
			recipe: group.recipe,
			portIndices: Object.freeze([...group.portIndices]),
		});
	}
	return Object.freeze({
		kind: "STK",
		template: group.template,
		portIndices: Object.freeze([...group.portIndices]),
	});
}

function copyEdges(
	edges: readonly OpenFabBlueprintEdgeTuple[],
): readonly OpenFabBlueprintEdgeTuple[] {
	return Object.freeze(edges.map((edge) => Object.freeze([...edge]) as OpenFabBlueprintEdgeTuple));
}

function organizationBundleEdgeTuples(
	bundle: StaticFabOrganizationBundle,
): readonly OpenFabBlueprintEdgeTuple[] {
	return Object.freeze(
		bundle.railEdges.map((edge) =>
			Object.freeze([edge.from.x, edge.from.y, edge.to.x, edge.to.y] as const),
		),
	);
}

function prepareOrganizationBundleOrThrow(input: unknown): StaticFabOrganizationBundle {
	const prepared = prepareStaticFabOrganizationBundle(input);
	if (!prepared.valid) {
		throw new TypeError(`Invalid static FAB organization bundle: ${prepared.reason}`);
	}
	return prepared.bundle;
}

function railAreaStampEdgeToTuple(edge: RailAreaStampEdge): OpenFabBlueprintEdgeTuple {
	return Object.freeze([edge.from.x, edge.from.y, edge.to.x, edge.to.y] as const);
}

function tupleToRailAreaStampEdge(edge: OpenFabBlueprintEdgeTuple): RailAreaStampEdge {
	return Object.freeze({
		from: Object.freeze({ x: edge[0], y: edge[1] }),
		to: Object.freeze({ x: edge[2], y: edge[3] }),
	});
}

function directionToOpenFab(direction: Direction): OpenFabBlueprintDirection {
	if (direction === DIR_N) return "N";
	if (direction === DIR_E) return "E";
	if (direction === DIR_S) return "S";
	return "W";
}

function openFabToDirection(direction: OpenFabBlueprintDirection): Direction {
	if (direction === "N") return DIR_N;
	if (direction === "E") return DIR_E;
	if (direction === "S") return DIR_S;
	return DIR_W;
}

export { STATIC_FAB_BLUEPRINT_MAX_EQUIPMENT_GROUPS, STATIC_FAB_BLUEPRINT_MAX_PORTS };
