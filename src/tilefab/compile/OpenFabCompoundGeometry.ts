import type { CompoundRailPatternType } from "./CompoundRailPattern";

export type CompoundFitKind = "MAP_EXACT" | "GRID_FIT";

export const COMPOUND_FIT_REASON = {
	NONE: 0,
	FORWARD_SPAN: 1,
	LATERAL_SPAN: 2,
	PROFILE_METRICS: 4,
} as const;

export interface NominalOpenFabCompoundProfile {
	id: string;
	type: CompoundRailPatternType;
	radiusMillimeters: number;
	turnAngleTenths: number;
	leadInMillimeters: number;
	leadOutMillimeters: number;
	middleMillimeters: number;
	outerLengthMillimeters: number;
	lengthMillimeters: number;
	forwardSpanMillimeters: number;
	lateralSpanMagnitudeMillimeters: number;
}

export interface Point2 {
	x: number;
	y: number;
}

export interface OpenFabCompoundGeometryOptions {
	nominalProfileId?: string;
	nominalProfile?: NominalOpenFabCompoundProfile;
}

export interface OpenFabCompoundGeometry {
	type: CompoundRailPatternType;
	fitKind: CompoundFitKind;
	fitReasonMask: number;
	nominalProfileIndex: number;
	lateralSideSign: -1 | 1;
	radiusMillimeters: number;
	turnAngleTenths: number;
	leadInMillimeters: number;
	leadOutMillimeters: number;
	middleMillimeters: number;
	nominalLeadInMillimeters: number;
	nominalLeadOutMillimeters: number;
	nominalMiddleMillimeters: number;
	nominalLengthMillimeters: number;
	compiledLengthMillimeters: number;
	forwardFitDeltaMillimeters: number;
	lateralFitDeltaMillimeters: number;
	leadInResidualMillimeters: number;
	leadOutResidualMillimeters: number;
	middleResidualMillimeters: number;
	lengthResidualMillimeters: number;
	positions: number[];
	tangents: number[];
	distances: number[];
	controlPoints: Float32Array;
	controlDistances: Float32Array;
	length: number;
	bounds: [number, number, number, number];
}

interface LineSegment {
	kind: "line";
	length: number;
}

interface ArcSegment {
	kind: "arc";
	radius: number;
	angle: number;
}

type ProfileSegment = LineSegment | ArcSegment;

interface SolvedProfile {
	radius: number;
	angle: number;
	leadIn: number;
	leadOut: number;
	middle: number;
	segments: readonly ProfileSegment[];
}

const R500_METERS = 0.5;
const SAMPLE_SPACING_METERS = 0.05;
const EPSILON = 1e-6;
const CATALOG_QUANTIZATION_METERS = 0.001;

export const ADVANCED_SWITCH_COMPOUND_PROFILE_IDS = {
	INPUT_S: "OPENFAB_ADV_INPUT_S_GRID_V1",
	OUTPUT_S: "OPENFAB_ADV_OUTPUT_S_GRID_V1",
	INPUT_RIGHT: "OPENFAB_ADV_INPUT_RIGHT_GRID_V1",
	OUTPUT_RIGHT: "OPENFAB_ADV_OUTPUT_RIGHT_GRID_V1",
} as const;

export const OPENFAB_COMPOUND_PROFILE_CATALOG: readonly NominalOpenFabCompoundProfile[] = [
	createNominalProfile("OPENFAB_CCW_R500_A180_L500_V1", "CCW_CURVE", 500, 1_800, 500, 500),
	createNominalProfile("OPENFAB_S_R500_A90_L500_V1", "S_CURVE", 500, 900, 500, 500),
	createNominalProfile(
		"OPENFAB_CSC_HOMO_R500_A90_L500_M1000_V1",
		"CSC_CURVE_HOMO",
		500,
		900,
		500,
		500,
		1_000,
	),
	createNominalProfile(
		"OPENFAB_CSC_HETE_R500_A90_L500_M1000_V1",
		"CSC_CURVE_HETE",
		500,
		900,
		500,
		500,
		1_000,
	),
	createNominalProfile(
		ADVANCED_SWITCH_COMPOUND_PROFILE_IDS.INPUT_S,
		"S_CURVE",
		500,
		900,
		500,
		500,
		1_000,
	),
	createNominalProfile(
		ADVANCED_SWITCH_COMPOUND_PROFILE_IDS.OUTPUT_S,
		"S_CURVE",
		500,
		900,
		500,
		500,
		1_000,
	),
	createNominalProfile(
		ADVANCED_SWITCH_COMPOUND_PROFILE_IDS.INPUT_RIGHT,
		"RIGHT_CURVE",
		500,
		900,
		500,
		500,
	),
	createNominalProfile(
		ADVANCED_SWITCH_COMPOUND_PROFILE_IDS.OUTPUT_RIGHT,
		"RIGHT_CURVE",
		500,
		900,
		500,
		500,
	),
] as const;

/** Build one full logical-node-to-logical-node compound edge in world coordinates. */
export function buildOpenFabCompoundGeometry(
	type: CompoundRailPatternType,
	start: Point2,
	end: Point2,
	startTangent: Point2,
	endTangent: Point2,
	options: OpenFabCompoundGeometryOptions = {},
): OpenFabCompoundGeometry | null {
	const forward = normalize(startTangent);
	const endDirection = normalize(endTangent);
	if (!forward || !endDirection) return null;
	const right = { x: -forward.y, y: forward.x };
	const displacement = { x: end.x - start.x, y: end.y - start.y };
	const longitudinal = dot(displacement, forward);
	const lateral = dot(displacement, right);
	if (Math.abs(lateral) < EPSILON) return null;
	const side = lateral > 0 ? 1 : -1;
	const nominalProfileIndex = options.nominalProfile
		? -1
		: resolveNominalProfileIndex(type, options.nominalProfileId);
	const nominalDefinition =
		options.nominalProfile ?? OPENFAB_COMPOUND_PROFILE_CATALOG[nominalProfileIndex];
	if (
		!nominalDefinition ||
		nominalDefinition.type !== type ||
		!isInternallyConsistentNominalProfile(nominalDefinition)
	) {
		return null;
	}
	const nominalAngle = (nominalDefinition.turnAngleTenths * Math.PI) / 1_800;
	const expectedEnd =
		type === "RIGHT_CURVE"
			? {
					x: forward.x * Math.cos(nominalAngle) + right.x * side * Math.sin(nominalAngle),
					y: forward.y * Math.cos(nominalAngle) + right.y * side * Math.sin(nominalAngle),
				}
			: type === "S_CURVE" || type === "CSC_CURVE_HETE"
				? forward
				: { x: -forward.x, y: -forward.y };
	if (dot(expectedEnd, endDirection) < 1 - 1e-5) return null;
	const nominal = nominalProfile(nominalDefinition, side);
	const solved = solveProfile(type, longitudinal, Math.abs(lateral), side, nominal);
	if (!solved) return null;
	const nominalEndpoint = profileEndpoint(nominal.segments);
	const local = sampleSegments(solved.segments);
	const lastOffset = local.positions.length - 2;
	if (
		Math.abs((local.positions[lastOffset] as number) - longitudinal) > 1e-5 ||
		Math.abs((local.positions[lastOffset + 1] as number) - lateral) > 1e-5
	) {
		return null;
	}
	const compiledLeadInMillimeters = Math.round(solved.leadIn * 1_000);
	const compiledLeadOutMillimeters = Math.round(solved.leadOut * 1_000);
	const compiledMiddleMillimeters = Math.round(solved.middle * 1_000);
	const compiledLengthMillimeters = Math.round((local.distances.at(-1) ?? 0) * 1_000);
	const forwardFitDeltaMillimeters = quantizedCatalogDeltaMillimeters(
		longitudinal - nominalEndpoint.x,
	);
	const lateralFitDeltaMillimeters = quantizedCatalogDeltaMillimeters(lateral - nominalEndpoint.y);
	const leadInResidualMillimeters = compiledLeadInMillimeters - nominalDefinition.leadInMillimeters;
	const leadOutResidualMillimeters =
		compiledLeadOutMillimeters - nominalDefinition.leadOutMillimeters;
	const middleResidualMillimeters = compiledMiddleMillimeters - nominalDefinition.middleMillimeters;
	const lengthResidualMillimeters = compiledLengthMillimeters - nominalDefinition.lengthMillimeters;
	const fitReasonMask =
		(forwardFitDeltaMillimeters !== 0 ? COMPOUND_FIT_REASON.FORWARD_SPAN : 0) |
		(lateralFitDeltaMillimeters !== 0 ? COMPOUND_FIT_REASON.LATERAL_SPAN : 0) |
		(leadInResidualMillimeters !== 0 ||
		leadOutResidualMillimeters !== 0 ||
		middleResidualMillimeters !== 0 ||
		lengthResidualMillimeters !== 0
			? COMPOUND_FIT_REASON.PROFILE_METRICS
			: 0);
	const fitKind: CompoundFitKind = fitReasonMask === 0 ? "MAP_EXACT" : "GRID_FIT";

	const positions = transformPairs(local.positions, start, forward, right);
	const tangents = transformVectors(local.tangents, forward, right);
	const controlPoints = new Float32Array(
		transformPairs(local.controlPoints, start, forward, right),
	);
	positions[positions.length - 2] = end.x;
	positions[positions.length - 1] = end.y;
	tangents[tangents.length - 2] = endDirection.x;
	tangents[tangents.length - 1] = endDirection.y;
	controlPoints[controlPoints.length - 2] = end.x;
	controlPoints[controlPoints.length - 1] = end.y;

	return {
		type,
		fitKind,
		fitReasonMask,
		nominalProfileIndex,
		lateralSideSign: side,
		radiusMillimeters: Math.round(solved.radius * 1_000),
		turnAngleTenths: Math.round((solved.angle * 1_800) / Math.PI),
		leadInMillimeters: compiledLeadInMillimeters,
		leadOutMillimeters: compiledLeadOutMillimeters,
		middleMillimeters: compiledMiddleMillimeters,
		nominalLeadInMillimeters: Math.round(nominal.leadIn * 1_000),
		nominalLeadOutMillimeters: Math.round(nominal.leadOut * 1_000),
		nominalMiddleMillimeters: Math.round(nominal.middle * 1_000),
		nominalLengthMillimeters: Math.round(profileLength(nominal.segments) * 1_000),
		compiledLengthMillimeters,
		forwardFitDeltaMillimeters,
		lateralFitDeltaMillimeters,
		leadInResidualMillimeters,
		leadOutResidualMillimeters,
		middleResidualMillimeters,
		lengthResidualMillimeters,
		positions,
		tangents,
		distances: local.distances,
		controlPoints,
		controlDistances: new Float32Array(local.controlDistances),
		length: local.distances.at(-1) ?? 0,
		bounds: boundsOf(positions),
	};
}

function solveProfile(
	type: CompoundRailPatternType,
	longitudinal: number,
	lateral: number,
	side: number,
	nominal: SolvedProfile,
): SolvedProfile | null {
	if (type === "RIGHT_CURVE") {
		const radius = nominal.radius;
		const angle = nominal.angle;
		const sine = Math.sin(angle);
		if (Math.abs(sine) < EPSILON) return null;
		const leadOut = clampNonNegative((lateral - radius * (1 - Math.cos(angle))) / sine);
		const leadIn = clampNonNegative(
			longitudinal - radius * Math.sin(angle) - leadOut * Math.cos(angle),
		);
		if (!nonNegative(leadIn, leadOut)) return null;
		return {
			radius,
			angle,
			leadIn,
			leadOut,
			middle: 0,
			segments: [line(leadIn), arc(radius, side * angle), line(leadOut)],
		};
	}
	if (type === "CCW_CURVE") {
		const radius = nominal.radius;
		const angle = nominal.angle;
		if (Math.abs(lateral - 2 * radius) > 1e-5) return null;
		const leadTotal = nominal.leadIn + nominal.leadOut;
		const leadIn = clampNonNegative((leadTotal + longitudinal) / 2);
		const leadOut = clampNonNegative((leadTotal - longitudinal) / 2);
		if (!nonNegative(leadIn, leadOut)) return null;
		return {
			radius,
			angle,
			leadIn,
			leadOut,
			middle: 0,
			segments: [line(leadIn), arc(radius, side * angle), line(leadOut)],
		};
	}

	if (type === "S_CURVE") {
		const radius = nominal.radius;
		const angle = nominal.angle;
		const middle = clampNonNegative(
			(lateral - 2 * radius * (1 - Math.cos(angle))) / Math.sin(angle),
		);
		const curvedForward = 2 * radius * Math.sin(angle) + middle * Math.cos(angle);
		const leadTotal = longitudinal - curvedForward;
		const leadDifference = nominal.leadIn - nominal.leadOut;
		const leadIn = clampNonNegative((leadTotal + leadDifference) / 2);
		const leadOut = clampNonNegative((leadTotal - leadDifference) / 2);
		if (!nonNegative(middle, leadIn, leadOut)) return null;
		return {
			radius,
			angle,
			leadIn,
			leadOut,
			middle,
			segments: [
				line(leadIn),
				arc(radius, side * angle),
				line(middle),
				arc(radius, -side * angle),
				line(leadOut),
			],
		};
	}

	if (type === "CSC_CURVE_HOMO") {
		const radius = R500_METERS;
		const angle = Math.PI / 2;
		const middle = clampNonNegative(lateral - 2 * radius);
		const leadTotal = nominal.leadIn + nominal.leadOut;
		const leadIn = clampNonNegative((leadTotal + longitudinal) / 2);
		const leadOut = clampNonNegative((leadTotal - longitudinal) / 2);
		if (!nonNegative(middle, leadIn, leadOut)) return null;
		return {
			radius,
			angle,
			leadIn,
			leadOut,
			middle,
			segments: [
				line(leadIn),
				arc(radius, side * angle),
				line(middle),
				arc(radius, side * angle),
				line(leadOut),
			],
		};
	}

	const radius = R500_METERS;
	const angle = Math.PI / 2;
	const middle = clampNonNegative(lateral - 2 * radius);
	const leadTotal = longitudinal - 2 * radius;
	const leadDifference = nominal.leadIn - nominal.leadOut;
	const leadIn = clampNonNegative((leadTotal + leadDifference) / 2);
	const leadOut = clampNonNegative((leadTotal - leadDifference) / 2);
	if (!nonNegative(middle, leadIn, leadOut)) return null;
	return {
		radius,
		angle,
		leadIn,
		leadOut,
		middle,
		segments: [
			line(leadIn),
			arc(radius, side * angle),
			line(middle),
			arc(radius, -side * angle),
			line(leadOut),
		],
	};
}

function createNominalProfile(
	id: string,
	type: CompoundRailPatternType,
	radiusMillimeters: number,
	turnAngleTenths: number,
	leadInMillimeters: number,
	leadOutMillimeters: number,
	middleMillimeters = 0,
): NominalOpenFabCompoundProfile {
	const arcCount = type === "RIGHT_CURVE" || type === "CCW_CURVE" ? 1 : 2;
	const radius = radiusMillimeters / 1_000;
	const angle = (turnAngleTenths * Math.PI) / 1_800;
	const outerLengthMillimeters = Math.round(
		(arcCount * radius * angle + middleMillimeters / 1_000) * 1_000,
	);
	const base: NominalOpenFabCompoundProfile = {
		id,
		type,
		radiusMillimeters,
		turnAngleTenths,
		leadInMillimeters,
		leadOutMillimeters,
		middleMillimeters,
		outerLengthMillimeters,
		lengthMillimeters: leadInMillimeters + outerLengthMillimeters + leadOutMillimeters,
		forwardSpanMillimeters: 0,
		lateralSpanMagnitudeMillimeters: 0,
	};
	const endpoint = profileEndpoint(nominalProfile(base, 1).segments);
	return Object.freeze({
		...base,
		forwardSpanMillimeters: Math.round(endpoint.x * 1_000),
		lateralSpanMagnitudeMillimeters: Math.round(Math.abs(endpoint.y) * 1_000),
	});
}

function nominalProfile(definition: NominalOpenFabCompoundProfile, side: number): SolvedProfile {
	const radius = definition.radiusMillimeters / 1_000;
	const angle = (definition.turnAngleTenths * Math.PI) / 1_800;
	const leadIn = definition.leadInMillimeters / 1_000;
	const leadOut = definition.leadOutMillimeters / 1_000;
	const middle =
		definition.type === "RIGHT_CURVE" || definition.type === "CCW_CURVE"
			? 0
			: definition.outerLengthMillimeters / 1_000 - 2 * radius * angle;
	if (definition.type === "RIGHT_CURVE" || definition.type === "CCW_CURVE") {
		return {
			radius,
			angle,
			leadIn,
			leadOut,
			middle,
			segments: [line(leadIn), arc(radius, side * angle), line(leadOut)],
		};
	}
	if (definition.type === "S_CURVE") {
		return {
			radius,
			angle,
			leadIn,
			leadOut,
			middle,
			segments: [
				line(leadIn),
				arc(radius, side * angle),
				line(middle),
				arc(radius, -side * angle),
				line(leadOut),
			],
		};
	}
	if (definition.type === "CSC_CURVE_HOMO") {
		return {
			radius,
			angle,
			leadIn,
			leadOut,
			middle,
			segments: [
				line(leadIn),
				arc(radius, side * angle),
				line(middle),
				arc(radius, side * angle),
				line(leadOut),
			],
		};
	}
	return {
		radius,
		angle,
		leadIn,
		leadOut,
		middle,
		segments: [
			line(leadIn),
			arc(radius, side * angle),
			line(middle),
			arc(radius, -side * angle),
			line(leadOut),
		],
	};
}

function isInternallyConsistentNominalProfile(definition: NominalOpenFabCompoundProfile): boolean {
	const radius = definition.radiusMillimeters / 1_000;
	const angle = (definition.turnAngleTenths * Math.PI) / 1_800;
	const arcCount = definition.type === "RIGHT_CURVE" || definition.type === "CCW_CURVE" ? 1 : 2;
	const expectedOuterMillimeters = Math.round(
		(arcCount * radius * angle + definition.middleMillimeters / 1_000) * 1_000,
	);
	return (
		Number.isInteger(definition.radiusMillimeters) &&
		definition.radiusMillimeters > 0 &&
		Number.isInteger(definition.turnAngleTenths) &&
		definition.turnAngleTenths > 0 &&
		Number.isInteger(definition.leadInMillimeters) &&
		definition.leadInMillimeters >= 0 &&
		Number.isInteger(definition.leadOutMillimeters) &&
		definition.leadOutMillimeters >= 0 &&
		Number.isInteger(definition.middleMillimeters) &&
		definition.middleMillimeters >= 0 &&
		definition.outerLengthMillimeters === expectedOuterMillimeters
	);
}

function quantizedCatalogDeltaMillimeters(deltaMeters: number): number {
	return Math.abs(deltaMeters) < CATALOG_QUANTIZATION_METERS ? 0 : Math.round(deltaMeters * 1_000);
}

function resolveNominalProfileIndex(
	type: CompoundRailPatternType,
	nominalProfileId?: string,
): number {
	if (nominalProfileId) {
		return OPENFAB_COMPOUND_PROFILE_CATALOG.findIndex(
			(profile) => profile.id === nominalProfileId && profile.type === type,
		);
	}
	if (type === "CCW_CURVE") return 0;
	if (type === "S_CURVE") return 1;
	if (type === "CSC_CURVE_HOMO") return 2;
	if (type === "CSC_CURVE_HETE") return 3;
	return -1;
}

function profileEndpoint(segments: readonly ProfileSegment[]): Point2 {
	const sampled = sampleSegments(segments);
	return {
		x: sampled.positions.at(-2) ?? 0,
		y: sampled.positions.at(-1) ?? 0,
	};
}

function profileLength(segments: readonly ProfileSegment[]): number {
	let length = 0;
	for (const segment of segments) {
		length += segment.kind === "line" ? segment.length : segment.radius * Math.abs(segment.angle);
	}
	return length;
}

function sampleSegments(segments: readonly ProfileSegment[]): {
	positions: number[];
	tangents: number[];
	distances: number[];
	controlPoints: number[];
	controlDistances: number[];
} {
	const positions = [0, 0];
	const tangents = [1, 0];
	const distances = [0];
	const controlPoints = [0, 0];
	const controlDistances = [0];
	let x = 0;
	let y = 0;
	let heading = 0;
	let distance = 0;

	for (const segment of segments) {
		const segmentLength =
			segment.kind === "line" ? segment.length : segment.radius * Math.abs(segment.angle);
		const sampleCount = Math.max(1, Math.ceil(segmentLength / SAMPLE_SPACING_METERS));
		const startX = x;
		const startY = y;
		const startHeading = heading;
		for (let sampleIndex = 1; sampleIndex <= sampleCount; sampleIndex++) {
			const amount = sampleIndex / sampleCount;
			if (segment.kind === "line") {
				const traveled = segment.length * amount;
				x = startX + Math.cos(startHeading) * traveled;
				y = startY + Math.sin(startHeading) * traveled;
			} else {
				const sign = segment.angle >= 0 ? 1 : -1;
				const swept = Math.abs(segment.angle) * amount;
				const sampleHeading = startHeading + sign * swept;
				x = startX + (segment.radius / sign) * (Math.sin(sampleHeading) - Math.sin(startHeading));
				y = startY - (segment.radius / sign) * (Math.cos(sampleHeading) - Math.cos(startHeading));
				heading = sampleHeading;
			}
			positions.push(x, y);
			tangents.push(Math.cos(heading), Math.sin(heading));
			distances.push(distance + segmentLength * amount);
		}
		if (segment.kind === "line") heading = startHeading;
		distance += segmentLength;
		controlPoints.push(x, y);
		controlDistances.push(distance);
	}
	return { positions, tangents, distances, controlPoints, controlDistances };
}

function transformPairs(
	values: readonly number[],
	origin: Point2,
	forward: Point2,
	right: Point2,
): number[] {
	const transformed: number[] = [];
	for (let index = 0; index < values.length; index += 2) {
		const x = values[index] as number;
		const y = values[index + 1] as number;
		transformed.push(
			origin.x + forward.x * x + right.x * y,
			origin.y + forward.y * x + right.y * y,
		);
	}
	return transformed;
}

function transformVectors(values: readonly number[], forward: Point2, right: Point2): number[] {
	const transformed: number[] = [];
	for (let index = 0; index < values.length; index += 2) {
		const x = values[index] as number;
		const y = values[index + 1] as number;
		transformed.push(forward.x * x + right.x * y, forward.y * x + right.y * y);
	}
	return transformed;
}

function boundsOf(positions: readonly number[]): [number, number, number, number] {
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	for (let index = 0; index < positions.length; index += 2) {
		minX = Math.min(minX, positions[index] as number);
		minY = Math.min(minY, positions[index + 1] as number);
		maxX = Math.max(maxX, positions[index] as number);
		maxY = Math.max(maxY, positions[index + 1] as number);
	}
	return [minX, minY, maxX, maxY];
}

function line(length: number): LineSegment {
	return { kind: "line", length };
}

function arc(radius: number, angle: number): ArcSegment {
	return { kind: "arc", radius, angle };
}

function normalize(point: Point2): Point2 | null {
	const length = Math.hypot(point.x, point.y);
	return length < EPSILON ? null : { x: point.x / length, y: point.y / length };
}

function dot(left: Point2, right: Point2): number {
	return left.x * right.x + left.y * right.y;
}

function nonNegative(...values: readonly number[]): boolean {
	return values.every((value) => value >= -EPSILON);
}

function clampNonNegative(value: number): number {
	return value < 0 && value >= -EPSILON ? 0 : value;
}
