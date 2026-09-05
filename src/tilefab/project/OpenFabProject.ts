import {
	type AdvancedSwitchProfileClass,
	type AdvancedSwitchRecord,
	copyAdvancedSwitch,
} from "../core/AdvancedSwitch";
import {
	copyEquipmentGroupRecord,
	copyPortEquipmentState,
	type EquipmentGroupRecord,
	type PortEquipmentState,
} from "../core/EquipmentGroup";
import {
	copyOperationalConfigurationState,
	emptyOperationalConfigurationState,
	type OperationalConfigurationState,
} from "../core/OperationalConfiguration";
import {
	copyPortRecord,
	type PortDirection,
	type PortRecord,
	type PortSide,
	type PortType,
} from "../core/PortRecord";
import type { RailDocument } from "../core/RailDocument";
import { DIR_E, DIR_N, DIR_S, DIR_W, type Direction } from "../core/railShape";
import {
	createAdvancedSwitchRecordFields,
	readAdvancedSwitchRecord,
	validateAdvancedSwitchRecordFieldLengths,
	writeAdvancedSwitchRecord,
} from "../worker/AdvancedSwitchSoA";
import {
	createPortEquipmentSnapshot,
	hydratePortEquipmentSnapshot,
} from "../worker/PortEquipmentSoA";
import {
	assertInt32Coordinate,
	captureRailMirrorSnapshot,
	checksumRailMirrorSnapshot,
	RailChecksumAccumulator,
	type RailMirrorSnapshot,
} from "../worker/RailMirrorChecksum";
import {
	createStaticFabAssemblyRelationshipSnapshot,
	hydrateStaticFabAssemblyRelationshipSnapshot,
} from "../worker/StaticFabAssemblyRelationshipSoA";
import {
	createStaticFabOrganizationSnapshot,
	hydrateStaticFabOrganizationSnapshot,
} from "../worker/StaticFabOrganizationSoA";
import {
	copyOpenFabProjectBlueprintSection,
	createEmptyOpenFabProjectBlueprintSection,
	type OpenFabProjectBlueprintSection,
} from "./OpenFabBlueprintLibrary";
import {
	captureOpenFabProjectOrganizationSection,
	createStaticFabOrganizationStateFromOpenFabProjectSection,
	type OpenFabProjectOrganizationSection,
} from "./OpenFabProjectOrganizations";
import {
	captureOpenFabProjectRelationshipSection,
	createStaticFabAssemblyRelationshipStateFromOpenFabProjectSection,
	type OpenFabProjectRelationshipSection,
} from "./OpenFabProjectRelationships";

export const OPENFAB_PROJECT_KIND = "openfab/tilefab-project" as const;
export const OPENFAB_PROJECT_SCHEMA_VERSION = 11 as const;
export const OPENFAB_RAIL_GRAMMAR = "directed-cardinal-1m-v1" as const;
export const OPENFAB_RAIL_CELL_ENCODING = "incoming-low-outgoing-high-v1" as const;
export const OPENFAB_RAIL_CELL_SIZE_MILLIMETERS = 1_000 as const;
export const OPENFAB_RESERVED_SECTION_SCHEMA_VERSION = 0 as const;
export const OPENFAB_PORT_SECTION_SCHEMA_VERSION = 1 as const;
export const OPENFAB_EQUIPMENT_SECTION_SCHEMA_VERSION = 1 as const;
export const OPENFAB_PROJECT_VIEW_MIN_ZOOM_PIXELS_PER_METER = 0.25;
export const OPENFAB_PROJECT_VIEW_MAX_ZOOM_PIXELS_PER_METER = 512;

export const OPENFAB_PROJECT_DIRECTION_NAMES = ["N", "E", "S", "W"] as const;

export type OpenFabProjectDirection = (typeof OPENFAB_PROJECT_DIRECTION_NAMES)[number];
export type OpenFabProjectRailPresentation = "profiled" | "diagnostic";
export type OpenFabProjectQuarterTurns = 0 | 1 | 2 | 3;
export type OpenFabRailCellTuple = readonly [x: number, z: number, encoded: number];

export interface OpenFabProjectManifest {
	readonly id: string;
	readonly name: string;
	readonly createdAt: string;
	readonly updatedAt: string;
}

export interface OpenFabProjectView {
	readonly center: readonly [x: number, z: number];
	readonly zoomPixelsPerMeter: number;
	readonly quarterTurns: OpenFabProjectQuarterTurns;
	readonly railPresentation: OpenFabProjectRailPresentation;
}

export interface OpenFabProjectAdvancedSwitch {
	readonly id: number;
	readonly profileClass: AdvancedSwitchProfileClass;
	readonly origin: readonly [x: number, z: number];
	readonly forward: OpenFabProjectDirection;
	readonly lateral: OpenFabProjectDirection;
	readonly movementMask: number;
}

export interface OpenFabProjectRailSection {
	readonly grammar: typeof OPENFAB_RAIL_GRAMMAR;
	readonly cellSizeMillimeters: typeof OPENFAB_RAIL_CELL_SIZE_MILLIMETERS;
	readonly cellEncoding: typeof OPENFAB_RAIL_CELL_ENCODING;
	readonly revision: number;
	readonly patchSequence: number;
	readonly nextAdvancedSwitchId: number;
	readonly cells: readonly OpenFabRailCellTuple[];
	readonly advancedSwitches: readonly OpenFabProjectAdvancedSwitch[];
}

export interface OpenFabProjectCardinalPortRoute {
	readonly kind: "CARDINAL_CELL";
	readonly cell: readonly [x: number, z: number];
	readonly from: OpenFabProjectDirection | null;
	readonly to: OpenFabProjectDirection | null;
}

export interface OpenFabProjectAdvancedSwitchPortRoute {
	readonly kind: "ADVANCED_SWITCH_SEGMENT";
	readonly switchId: number;
	readonly profileClass: AdvancedSwitchProfileClass;
	readonly role: "INPUT" | "THROAT" | "OUTPUT";
	readonly portIndex: 0 | 1 | null;
	readonly segmentOrdinal: number;
}

export type OpenFabProjectPortRoute =
	| OpenFabProjectCardinalPortRoute
	| OpenFabProjectAdvancedSwitchPortRoute;

export interface OpenFabProjectPort {
	readonly id: number;
	readonly equipmentGroupId: number;
	readonly route: OpenFabProjectPortRoute;
	readonly stationMillimeters: number;
	readonly side: PortSide;
	readonly lateralOffsetMillimeters: number;
	readonly direction: PortDirection;
	readonly portType: PortType;
	readonly barcode: string | null;
}

export interface OpenFabProjectPortSection {
	readonly schemaVersion: typeof OPENFAB_PORT_SECTION_SCHEMA_VERSION;
	readonly nextPortId: number;
	readonly records: readonly OpenFabProjectPort[];
}

export type OpenFabProjectEquipmentGroup = EquipmentGroupRecord;

export interface OpenFabProjectEquipmentSection {
	readonly schemaVersion: typeof OPENFAB_EQUIPMENT_SECTION_SCHEMA_VERSION;
	readonly nextEquipmentGroupId: number;
	readonly records: readonly OpenFabProjectEquipmentGroup[];
}

/** Reserved sections deliberately reject records until their own authoring phase freezes a schema. */
export interface OpenFabProjectReservedSection {
	readonly schemaVersion: typeof OPENFAB_RESERVED_SECTION_SCHEMA_VERSION;
	readonly records: readonly never[];
}

export interface OpenFabProject {
	readonly kind: typeof OPENFAB_PROJECT_KIND;
	readonly schemaVersion: typeof OPENFAB_PROJECT_SCHEMA_VERSION;
	readonly manifest: OpenFabProjectManifest;
	readonly rail: OpenFabProjectRailSection;
	readonly ports: OpenFabProjectPortSection;
	readonly equipment: OpenFabProjectEquipmentSection;
	readonly operations: OperationalConfigurationState;
	readonly blueprints: OpenFabProjectBlueprintSection;
	readonly areas: OpenFabProjectOrganizationSection;
	readonly relationships: OpenFabProjectRelationshipSection;
	readonly scenarios: OpenFabProjectReservedSection;
	readonly view: OpenFabProjectView | null;
}

export interface CaptureOpenFabProjectOptions {
	readonly manifest: OpenFabProjectManifest;
	readonly view?: OpenFabProjectView | null;
	readonly blueprints?: OpenFabProjectBlueprintSection;
	readonly operations?: OperationalConfigurationState;
}

export function createOpenFabProjectManifest(
	id: string,
	name: string,
	createdAt: string,
): OpenFabProjectManifest {
	return Object.freeze({ id, name, createdAt, updatedAt: createdAt });
}

export function updateOpenFabProjectManifest(
	manifest: OpenFabProjectManifest,
	updatedAt: string,
	name = manifest.name,
): OpenFabProjectManifest {
	return Object.freeze({
		id: manifest.id,
		name,
		createdAt: manifest.createdAt,
		updatedAt,
	});
}

export function captureOpenFabProject(
	document: RailDocument,
	options: CaptureOpenFabProjectOptions,
): OpenFabProject {
	return captureOpenFabProjectFromRailSnapshot(
		captureRailMirrorSnapshot(
			document.map,
			document.getPatchSequence(),
			document.portEquipment,
			document.organizations,
			document.relationships,
		).snapshot,
		options,
	);
}

export function captureOpenFabProjectFromRailSnapshot(
	snapshot: RailMirrorSnapshot,
	options: CaptureOpenFabProjectOptions,
): OpenFabProject {
	if (checksumRailMirrorSnapshot(snapshot) !== snapshot.checksum) {
		throw new Error("OpenFab project source snapshot checksum does not match its typed buffers.");
	}
	const cells: OpenFabRailCellTuple[] = [];
	for (let index = 0; index < snapshot.encoded.length; index++) {
		const x = snapshot.xs[index] as number;
		const z = snapshot.ys[index] as number;
		const encoded = snapshot.encoded[index] as number;
		assertInt32Coordinate(x, "project x");
		assertInt32Coordinate(z, "project z");
		cells.push(Object.freeze([x, z, encoded]));
	}
	cells.sort(compareRailCells);

	validateAdvancedSwitchRecordFieldLengths(
		snapshot.switchRecords,
		snapshot.switchIds.length,
		"OpenFab project source snapshot",
	);
	const advancedSwitches: OpenFabProjectAdvancedSwitch[] = [];
	for (let index = 0; index < snapshot.switchIds.length; index++) {
		const id = snapshot.switchIds[index] as number;
		advancedSwitches.push(
			captureAdvancedSwitch(
				readAdvancedSwitchRecord(snapshot.switchRecords, index, id, `OpenFab project switch ${id}`),
			),
		);
	}
	advancedSwitches.sort((left, right) => left.id - right.id);
	const portEquipment = hydratePortEquipmentSnapshot(snapshot.portEquipment);
	const relationships = hydrateStaticFabAssemblyRelationshipSnapshot(snapshot.relationships);

	return Object.freeze({
		kind: OPENFAB_PROJECT_KIND,
		schemaVersion: OPENFAB_PROJECT_SCHEMA_VERSION,
		manifest: copyManifest(options.manifest),
		rail: Object.freeze({
			grammar: OPENFAB_RAIL_GRAMMAR,
			cellSizeMillimeters: OPENFAB_RAIL_CELL_SIZE_MILLIMETERS,
			cellEncoding: OPENFAB_RAIL_CELL_ENCODING,
			revision: snapshot.revision,
			patchSequence: snapshot.sequence,
			nextAdvancedSwitchId: snapshot.nextAdvancedSwitchId,
			cells: Object.freeze(cells),
			advancedSwitches: Object.freeze(advancedSwitches),
		}),
		ports: capturePortSection(portEquipment),
		equipment: captureEquipmentSection(portEquipment),
		operations: options.operations
			? copyOperationalConfigurationState(options.operations)
			: emptyOperationalConfigurationState(),
		blueprints: options.blueprints
			? copyOpenFabProjectBlueprintSection(options.blueprints)
			: createEmptyOpenFabProjectBlueprintSection(),
		areas: captureOpenFabProjectOrganizationSection(
			hydrateStaticFabOrganizationSnapshot(snapshot.organizations),
		),
		relationships: captureOpenFabProjectRelationshipSection(relationships),
		scenarios: createReservedSection(),
		view: options.view ? copyProjectView(options.view) : null,
	});
}

export function createOperationalConfigurationStateFromOpenFabProject(
	project: OpenFabProject,
): OperationalConfigurationState {
	return copyOperationalConfigurationState(project.operations);
}

export function createPortEquipmentStateFromOpenFabProject(
	project: OpenFabProject,
): PortEquipmentState {
	return copyPortEquipmentState({
		nextPortId: project.ports.nextPortId,
		nextEquipmentGroupId: project.equipment.nextEquipmentGroupId,
		ports: project.ports.records.map(openFabProjectPortToRecord),
		equipmentGroups: project.equipment.records,
	});
}

/** Convert validated authored project data into the existing Worker-first candidate source. */
export function createRailSnapshotFromOpenFabProject(project: OpenFabProject): RailMirrorSnapshot {
	const { rail } = project;
	const xs = new Int32Array(rail.cells.length);
	const ys = new Int32Array(rail.cells.length);
	const encoded = new Uint8Array(rail.cells.length);
	const switchIds = new Int32Array(rail.advancedSwitches.length);
	const switchRecords = createAdvancedSwitchRecordFields(rail.advancedSwitches.length);
	const checksum = new RailChecksumAccumulator();
	const portEquipment = createPortEquipmentStateFromOpenFabProject(project);

	for (let index = 0; index < rail.cells.length; index++) {
		const [x, z, value] = rail.cells[index] as OpenFabRailCellTuple;
		assertInt32Coordinate(x, "project snapshot x");
		assertInt32Coordinate(z, "project snapshot z");
		xs[index] = x;
		ys[index] = z;
		encoded[index] = value;
		checksum.addCell(x, z, value);
	}
	for (let index = 0; index < rail.advancedSwitches.length; index++) {
		const record = openFabAdvancedSwitchToRecord(
			rail.advancedSwitches[index] as OpenFabProjectAdvancedSwitch,
		);
		switchIds[index] = record.id;
		writeAdvancedSwitchRecord(switchRecords, index, record);
		checksum.addSwitch(record);
	}
	for (const port of portEquipment.ports) checksum.addPort(port);
	for (const group of portEquipment.equipmentGroups) checksum.addEquipmentGroup(group);
	const organizations = createStaticFabOrganizationStateFromOpenFabProjectSection(project.areas);
	for (const record of organizations.records) checksum.addOrganization(record);
	checksum.setOrganizationNextId(organizations.nextOrganizationId);
	const relationships = createStaticFabAssemblyRelationshipStateFromOpenFabProjectSection(
		project.relationships,
	);
	for (const record of relationships.records) checksum.addAssemblyRelationship(record);
	checksum.setAssemblyRelationshipNextId(relationships.nextRelationshipId);

	return {
		sequence: rail.patchSequence,
		revision: rail.revision,
		nextAdvancedSwitchId: rail.nextAdvancedSwitchId,
		xs,
		ys,
		encoded,
		switchIds,
		switchRecords,
		portEquipment: createPortEquipmentSnapshot(portEquipment),
		organizations: createStaticFabOrganizationSnapshot(organizations),
		relationships: createStaticFabAssemblyRelationshipSnapshot(relationships),
		checksum: checksum.digest(),
	};
}

export function railDirectionToOpenFab(direction: Direction): OpenFabProjectDirection {
	if (direction === DIR_N) return "N";
	if (direction === DIR_E) return "E";
	if (direction === DIR_S) return "S";
	return "W";
}

export function openFabDirectionToRail(direction: OpenFabProjectDirection): Direction {
	if (direction === "N") return DIR_N;
	if (direction === "E") return DIR_E;
	if (direction === "S") return DIR_S;
	return DIR_W;
}

export function openFabAdvancedSwitchToRecord(
	switchRecord: OpenFabProjectAdvancedSwitch,
): AdvancedSwitchRecord {
	return copyAdvancedSwitch({
		id: switchRecord.id,
		profileClass: switchRecord.profileClass,
		origin: { x: switchRecord.origin[0], y: switchRecord.origin[1] },
		forward: openFabDirectionToRail(switchRecord.forward),
		lateral: openFabDirectionToRail(switchRecord.lateral),
		movementMask: switchRecord.movementMask,
	});
}

export function openFabProjectPortToRecord(port: OpenFabProjectPort): PortRecord {
	return copyPortRecord({
		...port,
		route:
			port.route.kind === "CARDINAL_CELL"
				? {
						kind: "CARDINAL_CELL",
						x: port.route.cell[0],
						z: port.route.cell[1],
						from: port.route.from === null ? 0 : openFabDirectionToRail(port.route.from),
						to: port.route.to === null ? 0 : openFabDirectionToRail(port.route.to),
					}
				: { ...port.route },
	});
}

function captureAdvancedSwitch(record: AdvancedSwitchRecord): OpenFabProjectAdvancedSwitch {
	return Object.freeze({
		id: record.id,
		profileClass: record.profileClass,
		origin: Object.freeze([record.origin.x, record.origin.y] as const),
		forward: railDirectionToOpenFab(record.forward),
		lateral: railDirectionToOpenFab(record.lateral),
		movementMask: record.movementMask,
	});
}

function copyManifest(manifest: OpenFabProjectManifest): OpenFabProjectManifest {
	return Object.freeze({
		id: manifest.id,
		name: manifest.name,
		createdAt: manifest.createdAt,
		updatedAt: manifest.updatedAt,
	});
}

function copyProjectView(view: OpenFabProjectView): OpenFabProjectView {
	return Object.freeze({
		center: Object.freeze([view.center[0], view.center[1]] as const),
		zoomPixelsPerMeter: view.zoomPixelsPerMeter,
		quarterTurns: view.quarterTurns,
		railPresentation: view.railPresentation,
	});
}

function capturePortSection(state: PortEquipmentState): OpenFabProjectPortSection {
	const canonical = copyPortEquipmentState(state);
	return Object.freeze({
		schemaVersion: OPENFAB_PORT_SECTION_SCHEMA_VERSION,
		nextPortId: canonical.nextPortId,
		records: Object.freeze(canonical.ports.map(capturePortRecord)),
	});
}

function captureEquipmentSection(state: PortEquipmentState): OpenFabProjectEquipmentSection {
	const canonical = copyPortEquipmentState(state);
	return Object.freeze({
		schemaVersion: OPENFAB_EQUIPMENT_SECTION_SCHEMA_VERSION,
		nextEquipmentGroupId: canonical.nextEquipmentGroupId,
		records: Object.freeze(canonical.equipmentGroups.map(copyEquipmentGroupRecord)),
	});
}

function capturePortRecord(port: PortRecord): OpenFabProjectPort {
	return Object.freeze({
		id: port.id,
		equipmentGroupId: port.equipmentGroupId,
		route:
			port.route.kind === "CARDINAL_CELL"
				? Object.freeze({
						kind: "CARDINAL_CELL" as const,
						cell: Object.freeze([port.route.x, port.route.z] as const),
						from: port.route.from === 0 ? null : railDirectionToOpenFab(port.route.from),
						to: port.route.to === 0 ? null : railDirectionToOpenFab(port.route.to),
					})
				: Object.freeze({ ...port.route }),
		stationMillimeters: port.stationMillimeters,
		side: port.side,
		lateralOffsetMillimeters: port.lateralOffsetMillimeters,
		direction: port.direction,
		portType: port.portType,
		barcode: port.barcode,
	});
}

function createReservedSection(): OpenFabProjectReservedSection {
	return Object.freeze({
		schemaVersion: OPENFAB_RESERVED_SECTION_SCHEMA_VERSION,
		records: Object.freeze([]),
	});
}

function compareRailCells(left: OpenFabRailCellTuple, right: OpenFabRailCellTuple): number {
	return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
}
