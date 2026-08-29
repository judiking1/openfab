import {
	ADVANCED_SWITCH_SHARED_TRUNK_PROFILE,
	type AdvancedSwitchPortIndex,
	type AdvancedSwitchProfileClass,
	type AdvancedSwitchRecord,
	deriveAdvancedSwitchGeometry,
} from "../core/AdvancedSwitch";
import { type Direction, directionBetween, moveCell, oppositeDirection } from "../core/railShape";
import { type Cell, cellKey, type TileMap } from "../core/TileMap";
import {
	ADVANCED_SWITCH_COMPOUND_PROFILE_IDS,
	buildOpenFabCompoundGeometry,
	type OpenFabCompoundGeometry,
} from "./OpenFabCompoundGeometry";
import {
	buildCardinalCellPathGeometry,
	type CompiledPhysicalPaths,
	PATH_KIND,
	type PhysicalPathGeometry,
} from "./PhysicalPathCompiler";

export const ADVANCED_SWITCH_SEGMENT_ROLE = {
	INPUT: 0,
	THROAT: 1,
	OUTPUT: 2,
} as const;

export type AdvancedSwitchSegmentRole =
	(typeof ADVANCED_SWITCH_SEGMENT_ROLE)[keyof typeof ADVANCED_SWITCH_SEGMENT_ROLE];

export const ADVANCED_SWITCH_NO_PORT = 0xff;

export const ADVANCED_SWITCH_PROFILE_CLASS_CODE = {
	A: 0,
	B: 1,
	C: 2,
	D: 3,
} as const;

export const ADVANCED_SWITCH_PHYSICAL_PROFILE_CODE = {
	INPUT_LINEAR: 0,
	INPUT_S: 1,
	INPUT_RIGHT: 2,
	THROAT: 3,
	OUTPUT_LINEAR: 4,
	OUTPUT_S: 5,
	OUTPUT_RIGHT: 6,
} as const;

export type AdvancedSwitchPhysicalProfileCode =
	(typeof ADVANCED_SWITCH_PHYSICAL_PROFILE_CODE)[keyof typeof ADVANCED_SWITCH_PHYSICAL_PROFILE_CODE];

export interface AdvancedSwitchPhysicalProfile {
	readonly code: AdvancedSwitchPhysicalProfileCode;
	readonly id: string;
	readonly kind: "LINEAR" | "S_CURVE" | "RIGHT_CURVE";
	readonly nominalProfileId?: string;
}

export const ADVANCED_SWITCH_PHYSICAL_PROFILE_CATALOG: readonly AdvancedSwitchPhysicalProfile[] =
	Object.freeze([
		{
			code: ADVANCED_SWITCH_PHYSICAL_PROFILE_CODE.INPUT_LINEAR,
			id: "OPENFAB_ADV_INPUT_LINEAR_GRID_V1",
			kind: "LINEAR",
		},
		{
			code: ADVANCED_SWITCH_PHYSICAL_PROFILE_CODE.INPUT_S,
			id: ADVANCED_SWITCH_COMPOUND_PROFILE_IDS.INPUT_S,
			kind: "S_CURVE",
			nominalProfileId: ADVANCED_SWITCH_COMPOUND_PROFILE_IDS.INPUT_S,
		},
		{
			code: ADVANCED_SWITCH_PHYSICAL_PROFILE_CODE.INPUT_RIGHT,
			id: ADVANCED_SWITCH_COMPOUND_PROFILE_IDS.INPUT_RIGHT,
			kind: "RIGHT_CURVE",
			nominalProfileId: ADVANCED_SWITCH_COMPOUND_PROFILE_IDS.INPUT_RIGHT,
		},
		{
			code: ADVANCED_SWITCH_PHYSICAL_PROFILE_CODE.THROAT,
			id: "OPENFAB_ADV_THROAT_LINEAR_GRID_V1",
			kind: "LINEAR",
		},
		{
			code: ADVANCED_SWITCH_PHYSICAL_PROFILE_CODE.OUTPUT_LINEAR,
			id: "OPENFAB_ADV_OUTPUT_LINEAR_GRID_V1",
			kind: "LINEAR",
		},
		{
			code: ADVANCED_SWITCH_PHYSICAL_PROFILE_CODE.OUTPUT_S,
			id: ADVANCED_SWITCH_COMPOUND_PROFILE_IDS.OUTPUT_S,
			kind: "S_CURVE",
			nominalProfileId: ADVANCED_SWITCH_COMPOUND_PROFILE_IDS.OUTPUT_S,
		},
		{
			code: ADVANCED_SWITCH_PHYSICAL_PROFILE_CODE.OUTPUT_RIGHT,
			id: ADVANCED_SWITCH_COMPOUND_PROFILE_IDS.OUTPUT_RIGHT,
			kind: "RIGHT_CURVE",
			nominalProfileId: ADVANCED_SWITCH_COMPOUND_PROFILE_IDS.OUTPUT_RIGHT,
		},
	]);

export interface AdvancedSwitchPhysicalSegmentIdentity {
	readonly switchId: number;
	readonly profileClass: AdvancedSwitchProfileClass;
	readonly role: AdvancedSwitchSegmentRole;
	readonly portIndex: AdvancedSwitchPortIndex | typeof ADVANCED_SWITCH_NO_PORT;
	readonly segmentOrdinal: number;
}

export interface AdvancedSwitchPhysicalSegment {
	readonly identity: AdvancedSwitchPhysicalSegmentIdentity;
	readonly packedIdentity: bigint;
	readonly entryCell: Cell;
	readonly exitCell: Cell;
	readonly fromDirection: Direction;
	readonly toDirection: Direction;
	readonly geometry: PhysicalPathGeometry;
	readonly catalogProfileCode: AdvancedSwitchPhysicalProfileCode;
	readonly catalogProfileId: string;
	readonly compoundGeometry: OpenFabCompoundGeometry | null;
	readonly coverage: readonly Cell[];
	readonly successors: readonly bigint[];
	readonly sharedEdge: "start" | "end" | null;
	readonly sharedLengthMeters: number;
}

export interface AdvancedSwitchPhysicalVariant {
	readonly switchRecord: AdvancedSwitchRecord;
	readonly segments: readonly AdvancedSwitchPhysicalSegment[];
	readonly ownedCells: readonly Cell[];
}

const MAX_SEGMENT_ORDINAL = 0xffff;
const IDENTITY_PROFILE_SHIFT = 20n;
const IDENTITY_ROLE_SHIFT = 18n;
const IDENTITY_PORT_SHIFT = 16n;
const IDENTITY_SWITCH_SHIFT = 22n;
const GEOMETRY_EPSILON = 1e-6;

/** Exact, collision-free identity for one derived switch-owned physical segment. */
export function advancedSwitchPhysicalSegmentKey(
	identity: AdvancedSwitchPhysicalSegmentIdentity,
): bigint {
	if (
		!Number.isInteger(identity.switchId) ||
		identity.switchId <= 0 ||
		identity.switchId > 0x7fff_ffff
	) {
		throw new RangeError("advanced switch physical identity requires a positive signed-int32 id");
	}
	if (
		!Number.isInteger(identity.segmentOrdinal) ||
		identity.segmentOrdinal < 0 ||
		identity.segmentOrdinal > MAX_SEGMENT_ORDINAL
	) {
		throw new RangeError("advanced switch segment ordinal must fit uint16");
	}
	if (
		identity.role !== ADVANCED_SWITCH_SEGMENT_ROLE.INPUT &&
		identity.role !== ADVANCED_SWITCH_SEGMENT_ROLE.THROAT &&
		identity.role !== ADVANCED_SWITCH_SEGMENT_ROLE.OUTPUT
	) {
		throw new RangeError("advanced switch segment role is invalid");
	}
	const portCode = identity.portIndex === ADVANCED_SWITCH_NO_PORT ? 3 : identity.portIndex;
	if (
		(portCode !== 0 && portCode !== 1 && portCode !== 3) ||
		(identity.role === ADVANCED_SWITCH_SEGMENT_ROLE.THROAT) !== (portCode === 3)
	) {
		throw new RangeError("only the throat segment may omit a boundary port");
	}
	const profileCode = ADVANCED_SWITCH_PROFILE_CLASS_CODE[identity.profileClass];
	return (
		(BigInt(identity.switchId) << IDENTITY_SWITCH_SHIFT) |
		(BigInt(profileCode) << IDENTITY_PROFILE_SHIFT) |
		(BigInt(identity.role) << IDENTITY_ROLE_SHIFT) |
		(BigInt(portCode) << IDENTITY_PORT_SHIFT) |
		BigInt(identity.segmentOrdinal)
	);
}

/** Derive immutable project-catalog physical variants from authored switch records. */
export function compileAdvancedSwitchPhysicalVariants(
	map: TileMap,
): readonly AdvancedSwitchPhysicalVariant[] {
	const records: AdvancedSwitchRecord[] = [];
	map.forEachAdvancedSwitch((record) => records.push(record));
	records.sort((left, right) => left.id - right.id);
	const seen = new Set<bigint>();
	return records.map((record) => {
		const variant = compileAdvancedSwitchPhysicalVariant(record);
		for (const segment of variant.segments) {
			if (seen.has(segment.packedIdentity)) {
				throw new Error(`duplicate advanced-switch physical identity ${segment.packedIdentity}`);
			}
			seen.add(segment.packedIdentity);
		}
		return variant;
	});
}

/** Raw cardinal paths beginning inside a module are replaced, never projected onto synthetic paths. */
export function collectAdvancedSwitchOwnedSourcePaths(
	variants: readonly AdvancedSwitchPhysicalVariant[],
	paths: CompiledPhysicalPaths,
): ReadonlySet<number> {
	const owned = new Set<string>();
	for (const variant of variants) {
		for (const cell of variant.ownedCells) owned.add(cellKey(cell.x, cell.y));
	}
	const result = new Set<number>();
	for (let pathIndex = 0; pathIndex < paths.pathCount; pathIndex++) {
		const offset = pathIndex * 2;
		if (owned.has(cellKey(paths.cells[offset] as number, paths.cells[offset + 1] as number))) {
			result.add(pathIndex);
		}
	}
	return result;
}

export function compileAdvancedSwitchPhysicalVariant(
	switchRecord: AdvancedSwitchRecord,
): AdvancedSwitchPhysicalVariant {
	const geometry = deriveAdvancedSwitchGeometry(switchRecord);
	const inputIdentities = ([0, 1] as const).map((portIndex) =>
		identity(switchRecord, ADVANCED_SWITCH_SEGMENT_ROLE.INPUT, portIndex),
	);
	const throatIdentity = identity(
		switchRecord,
		ADVANCED_SWITCH_SEGMENT_ROLE.THROAT,
		ADVANCED_SWITCH_NO_PORT,
	);
	const outputIdentities = ([0, 1] as const).map((portIndex) =>
		identity(switchRecord, ADVANCED_SWITCH_SEGMENT_ROLE.OUTPUT, portIndex),
	);
	const throatKey = advancedSwitchPhysicalSegmentKey(throatIdentity);
	const outputKeys = outputIdentities.map(advancedSwitchPhysicalSegmentKey);
	const shared = ADVANCED_SWITCH_SHARED_TRUNK_PROFILE;
	const inputRoutes = [geometry.mainPath.slice(0, 3), geometry.secondaryInputPath] as const;
	const outputRoutes = [geometry.mainPath.slice(4), geometry.secondaryOutputPath] as const;
	const segments: AdvancedSwitchPhysicalSegment[] = [];

	for (const portIndex of [0, 1] as const) {
		const port = geometry.inputs[portIndex];
		const baseline = buildGridRouteGeometry(
			inputRoutes[portIndex],
			port.direction,
			switchRecord.forward,
			0,
			shared.mergeSharedLeadMeters,
		);
		const profile = inputPhysicalProfile(switchRecord.profileClass, portIndex);
		const compiled = compileCatalogGeometry(profile, baseline);
		const sweepCoverage =
			profile.kind === "S_CURVE"
				? [
						moveCell(
							moveCell(geometry.mergeAnchor, oppositeDirection(switchRecord.forward)),
							switchRecord.lateral,
						),
					]
				: [];
		segments.push({
			identity: inputIdentities[portIndex],
			packedIdentity: advancedSwitchPhysicalSegmentKey(inputIdentities[portIndex]),
			entryCell: port.cell,
			exitCell: geometry.sharedTrunkSupport,
			fromDirection: port.direction,
			toDirection: switchRecord.forward,
			geometry: compiled.geometry,
			catalogProfileCode: profile.code,
			catalogProfileId: profile.id,
			compoundGeometry: compiled.compoundGeometry,
			coverage: uniqueCells([
				...inputRoutes[portIndex],
				geometry.sharedTrunkSupport,
				...sweepCoverage,
			]),
			successors: [throatKey],
			sharedEdge: "end",
			sharedLengthMeters: shared.mergeSharedLeadMeters,
		});
	}

	const forwardVector = directionVector(switchRecord.forward);
	const throatStart = sidePoint(
		geometry.sharedTrunkSupport,
		oppositeDirection(switchRecord.forward),
	);
	const centerStart = {
		x: throatStart.x + forwardVector.x * shared.mergeSharedLeadMeters,
		y: throatStart.y + forwardVector.y * shared.mergeSharedLeadMeters,
	};
	const centerEnd = {
		x: centerStart.x + forwardVector.x * shared.clearTrunkMeters,
		y: centerStart.y + forwardVector.y * shared.clearTrunkMeters,
	};
	segments.push({
		identity: throatIdentity,
		packedIdentity: throatKey,
		entryCell: geometry.sharedTrunkSupport,
		exitCell: geometry.sharedTrunkSupport,
		fromDirection: oppositeDirection(switchRecord.forward),
		toDirection: switchRecord.forward,
		geometry: straightGeometry(centerStart, centerEnd),
		catalogProfileCode: ADVANCED_SWITCH_PHYSICAL_PROFILE_CODE.THROAT,
		catalogProfileId: advancedSwitchPhysicalProfile(ADVANCED_SWITCH_PHYSICAL_PROFILE_CODE.THROAT)
			.id,
		compoundGeometry: null,
		coverage: [geometry.sharedTrunkSupport],
		successors: outputKeys,
		sharedEdge: null,
		sharedLengthMeters: 0,
	});

	for (const portIndex of [0, 1] as const) {
		const port = geometry.outputs[portIndex];
		const baseline = buildGridRouteGeometry(
			outputRoutes[portIndex],
			oppositeDirection(switchRecord.forward),
			port.direction,
			shared.branchSharedLeadMeters,
			0,
		);
		const profile = outputPhysicalProfile(switchRecord.profileClass, portIndex);
		const compiled = compileCatalogGeometry(profile, baseline);
		const sweepCoverage =
			profile.kind === "S_CURVE"
				? [moveCell(moveCell(geometry.branchAnchor, switchRecord.forward), switchRecord.lateral)]
				: [];
		segments.push({
			identity: outputIdentities[portIndex],
			packedIdentity: outputKeys[portIndex] as bigint,
			entryCell: geometry.sharedTrunkSupport,
			exitCell: port.cell,
			fromDirection: oppositeDirection(switchRecord.forward),
			toDirection: port.direction,
			geometry: compiled.geometry,
			catalogProfileCode: profile.code,
			catalogProfileId: profile.id,
			compoundGeometry: compiled.compoundGeometry,
			coverage: uniqueCells([
				geometry.sharedTrunkSupport,
				...outputRoutes[portIndex],
				...sweepCoverage,
			]),
			successors: [],
			sharedEdge: "start",
			sharedLengthMeters: shared.branchSharedLeadMeters,
		});
	}

	return Object.freeze({
		switchRecord,
		segments: Object.freeze(segments),
		ownedCells: geometry.occupiedCells,
	});
}

export function advancedSwitchPhysicalProfile(code: number): AdvancedSwitchPhysicalProfile {
	const profile = ADVANCED_SWITCH_PHYSICAL_PROFILE_CATALOG.find((entry) => entry.code === code);
	if (!profile) throw new RangeError(`Unknown advanced-switch physical profile code ${code}.`);
	return profile;
}

function inputPhysicalProfile(
	profileClass: AdvancedSwitchProfileClass,
	portIndex: AdvancedSwitchPortIndex,
): AdvancedSwitchPhysicalProfile {
	if (portIndex === 0) {
		return advancedSwitchPhysicalProfile(ADVANCED_SWITCH_PHYSICAL_PROFILE_CODE.INPUT_LINEAR);
	}
	return advancedSwitchPhysicalProfile(
		profileClass === "A" || profileClass === "B"
			? ADVANCED_SWITCH_PHYSICAL_PROFILE_CODE.INPUT_S
			: ADVANCED_SWITCH_PHYSICAL_PROFILE_CODE.INPUT_RIGHT,
	);
}

function outputPhysicalProfile(
	profileClass: AdvancedSwitchProfileClass,
	portIndex: AdvancedSwitchPortIndex,
): AdvancedSwitchPhysicalProfile {
	if (portIndex === 0) {
		return advancedSwitchPhysicalProfile(ADVANCED_SWITCH_PHYSICAL_PROFILE_CODE.OUTPUT_LINEAR);
	}
	return advancedSwitchPhysicalProfile(
		profileClass === "B" || profileClass === "D"
			? ADVANCED_SWITCH_PHYSICAL_PROFILE_CODE.OUTPUT_S
			: ADVANCED_SWITCH_PHYSICAL_PROFILE_CODE.OUTPUT_RIGHT,
	);
}

function compileCatalogGeometry(
	profile: AdvancedSwitchPhysicalProfile,
	baseline: PhysicalPathGeometry,
): { geometry: PhysicalPathGeometry; compoundGeometry: OpenFabCompoundGeometry | null } {
	if (profile.kind === "LINEAR") return { geometry: baseline, compoundGeometry: null };
	const lastPoint = baseline.distances.length - 1;
	const compoundGeometry = buildOpenFabCompoundGeometry(
		profile.kind,
		{ x: baseline.positions[0] as number, y: baseline.positions[1] as number },
		{
			x: baseline.positions[lastPoint * 2] as number,
			y: baseline.positions[lastPoint * 2 + 1] as number,
		},
		{ x: baseline.tangents[0] as number, y: baseline.tangents[1] as number },
		{
			x: baseline.tangents[lastPoint * 2] as number,
			y: baseline.tangents[lastPoint * 2 + 1] as number,
		},
		{ nominalProfileId: profile.nominalProfileId },
	);
	if (!compoundGeometry || compoundGeometry.nominalProfileIndex < 0) {
		const detail = compoundGeometry
			? `fit=${compoundGeometry.fitKind}/${compoundGeometry.fitReasonMask}, delta=${compoundGeometry.forwardFitDeltaMillimeters}/${compoundGeometry.lateralFitDeltaMillimeters}, residual=${compoundGeometry.leadInResidualMillimeters}/${compoundGeometry.leadOutResidualMillimeters}/${compoundGeometry.middleResidualMillimeters}/${compoundGeometry.lengthResidualMillimeters}`
			: "geometry=null";
		throw new Error(
			`Advanced-switch profile ${profile.id} cannot solve its grid boundary (${detail}).`,
		);
	}
	return {
		geometry: {
			positions: [...compoundGeometry.positions],
			tangents: [...compoundGeometry.tangents],
			distances: [...compoundGeometry.distances],
			length: compoundGeometry.length,
			bounds: [...compoundGeometry.bounds],
		},
		compoundGeometry,
	};
}

function identity(
	switchRecord: AdvancedSwitchRecord,
	role: AdvancedSwitchSegmentRole,
	portIndex: AdvancedSwitchPortIndex | typeof ADVANCED_SWITCH_NO_PORT,
): AdvancedSwitchPhysicalSegmentIdentity {
	return Object.freeze({
		switchId: switchRecord.id,
		profileClass: switchRecord.profileClass,
		role,
		portIndex,
		segmentOrdinal: 0,
	});
}

function buildGridRouteGeometry(
	route: readonly Cell[],
	fromDirection: Direction,
	toDirection: Direction,
	startExtension: number,
	endExtension: number,
): PhysicalPathGeometry {
	if (route.length === 0) throw new Error("advanced switch route cannot be empty");
	const positions: number[] = [];
	const tangents: number[] = [];
	const distances: number[] = [];
	let length = 0;
	for (let index = 0; index < route.length; index++) {
		const cell = route[index] as Cell;
		const incoming = index === 0 ? fromDirection : directionBetween(cell, route[index - 1] as Cell);
		const outgoing =
			index === route.length - 1 ? toDirection : directionBetween(cell, route[index + 1] as Cell);
		if (!incoming || !outgoing) throw new Error("advanced switch route cells must be adjacent");
		const local = buildCardinalCellPathGeometry(cell.x, cell.y, incoming, outgoing);
		if (!local) throw new Error("advanced switch route contains an invalid cardinal module");
		appendGeometry(positions, tangents, distances, local, length, index > 0);
		length += local.length;
	}
	return extendGeometry(
		geometryFromSamples(positions, tangents, distances),
		startExtension,
		endExtension,
	);
}

function appendGeometry(
	positions: number[],
	tangents: number[],
	distances: number[],
	geometry: PhysicalPathGeometry,
	distanceOffset: number,
	skipFirst: boolean,
): void {
	for (let pointIndex = skipFirst ? 1 : 0; pointIndex < geometry.distances.length; pointIndex++) {
		positions.push(
			geometry.positions[pointIndex * 2] as number,
			geometry.positions[pointIndex * 2 + 1] as number,
		);
		tangents.push(
			geometry.tangents[pointIndex * 2] as number,
			geometry.tangents[pointIndex * 2 + 1] as number,
		);
		distances.push(distanceOffset + (geometry.distances[pointIndex] as number));
	}
}

function extendGeometry(
	geometry: PhysicalPathGeometry,
	startExtension: number,
	endExtension: number,
): PhysicalPathGeometry {
	const positions: number[] = [];
	const tangents: number[] = [];
	const distances: number[] = [];
	const firstTangent = {
		x: geometry.tangents[0] as number,
		y: geometry.tangents[1] as number,
	};
	if (startExtension > 0) {
		positions.push(
			(geometry.positions[0] as number) - firstTangent.x * startExtension,
			(geometry.positions[1] as number) - firstTangent.y * startExtension,
		);
		tangents.push(firstTangent.x, firstTangent.y);
		distances.push(0);
	}
	for (let pointIndex = 0; pointIndex < geometry.distances.length; pointIndex++) {
		positions.push(
			geometry.positions[pointIndex * 2] as number,
			geometry.positions[pointIndex * 2 + 1] as number,
		);
		tangents.push(
			geometry.tangents[pointIndex * 2] as number,
			geometry.tangents[pointIndex * 2 + 1] as number,
		);
		distances.push(startExtension + (geometry.distances[pointIndex] as number));
	}
	if (endExtension > 0) {
		const lastPoint = geometry.distances.length - 1;
		const tangent = {
			x: geometry.tangents[lastPoint * 2] as number,
			y: geometry.tangents[lastPoint * 2 + 1] as number,
		};
		positions.push(
			(geometry.positions[lastPoint * 2] as number) + tangent.x * endExtension,
			(geometry.positions[lastPoint * 2 + 1] as number) + tangent.y * endExtension,
		);
		tangents.push(tangent.x, tangent.y);
		distances.push(startExtension + geometry.length + endExtension);
	}
	return geometryFromSamples(positions, tangents, distances);
}

function straightGeometry(from: Cell, to: Cell): PhysicalPathGeometry {
	const dx = to.x - from.x;
	const dy = to.y - from.y;
	const length = Math.hypot(dx, dy);
	if (length <= GEOMETRY_EPSILON)
		throw new Error("advanced switch throat must have positive length");
	return geometryFromSamples(
		[from.x, from.y, to.x, to.y],
		[dx / length, dy / length, dx / length, dy / length],
		[0, length],
	);
}

function geometryFromSamples(
	positions: number[],
	tangents: number[],
	distances: number[],
): PhysicalPathGeometry {
	if (
		distances.length < 2 ||
		positions.length !== distances.length * 2 ||
		tangents.length !== positions.length
	) {
		throw new Error("advanced switch physical geometry has malformed samples");
	}
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	for (let pointIndex = 0; pointIndex < distances.length; pointIndex++) {
		const x = positions[pointIndex * 2] as number;
		const y = positions[pointIndex * 2 + 1] as number;
		minX = Math.min(minX, x);
		minY = Math.min(minY, y);
		maxX = Math.max(maxX, x);
		maxY = Math.max(maxY, y);
		if (
			pointIndex > 0 &&
			(distances[pointIndex] as number) <= (distances[pointIndex - 1] as number)
		) {
			throw new Error("advanced switch physical stations must be strictly increasing");
		}
	}
	return {
		positions,
		tangents,
		distances,
		length: distances.at(-1) as number,
		bounds: [minX, minY, maxX, maxY],
	};
}

function sidePoint(cell: Cell, direction: Direction): Cell {
	if (direction === 1) return { x: cell.x + 0.5, y: cell.y };
	if (direction === 2) return { x: cell.x + 1, y: cell.y + 0.5 };
	if (direction === 4) return { x: cell.x + 0.5, y: cell.y + 1 };
	return { x: cell.x, y: cell.y + 0.5 };
}

function directionVector(direction: Direction): Cell {
	if (direction === 1) return { x: 0, y: -1 };
	if (direction === 2) return { x: 1, y: 0 };
	if (direction === 4) return { x: 0, y: 1 };
	return { x: -1, y: 0 };
}

function uniqueCells(cells: readonly Cell[]): Cell[] {
	const result = new Map<string, Cell>();
	for (const cell of cells) result.set(cellKey(cell.x, cell.y), cell);
	return [...result.values()];
}

export function isAdvancedSwitchSyntheticPath(
	paths: CompiledPhysicalPaths,
	pathIndex: number,
): boolean {
	return (paths.kinds[pathIndex] as number) === PATH_KIND.ADVANCED_SWITCH_SEGMENT;
}
