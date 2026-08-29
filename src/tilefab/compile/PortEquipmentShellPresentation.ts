import { EQUIPMENT_GROUP_KINDS } from "../core/EquipmentGroup";
import { PORT_TYPES } from "../core/PortRecord";
import {
	type CompiledPortEquipmentInteractionPresentation,
	portEquipmentInteractionPresentationFor,
} from "./PortEquipmentInteractionPresentation";
import {
	type CompiledPortEquipmentPresentation,
	PORT_EQUIPMENT_BODY_FACE_KIND,
} from "./PortEquipmentPresentation";

export const PORT_EQUIPMENT_SHELL_PRESENTATION_POLICY =
	"PORT_DERIVED_BODY_SPANS_AND_STABLE_SLOT_RECORDS_V1" as const;

/** Public OpenFab visual profile. These are display dimensions, not equipment specifications. */
export const PORT_EQUIPMENT_SHELL_VISUAL_PROFILE = Object.freeze({
	portSlotHalfLengthMetersByKind: Object.freeze([0.14, 0.2, 0.24] as const),
	portOpeningHalfHeightMetersByKind: Object.freeze([0.11, 0.34, 0.42] as const),
	portOpeningWidthRatioByKind: Object.freeze([0.58, 0.72, 0.78] as const),
	internalSlotHalfHeightMeters: 0.035,
	minimumShellSpanHalfLengthMeters: 0.01,
});

export interface CompiledPortEquipmentShellPresentation {
	readonly policy: typeof PORT_EQUIPMENT_SHELL_PRESENTATION_POLICY;
	readonly revision: number;
	readonly bodySectionCount: number;
	readonly shellSpanCount: number;
	/** Exact source body-section row for every visible shell span. */
	readonly shellSpanBodySectionRows: Uint32Array;
	/** Stable physical equipment-group ID for every visible shell span. */
	readonly shellSpanEquipmentGroupIds: Int32Array;
	readonly shellSpanKinds: Uint8Array;
	/** Packed world X/Z centers. */
	readonly shellSpanCenters: Float32Array;
	/** Packed unit world X/Z tangents. */
	readonly shellSpanTangents: Float32Array;
	/** Packed along-track/cross-track half extents. */
	readonly shellSpanHalfExtents: Float32Array;
	readonly portSlotCount: number;
	/** Stable IDs ordered by body section, then stable port ID. */
	readonly portSlotIds: Int32Array;
	readonly portSlotEquipmentGroupIds: Int32Array;
	readonly portSlotKinds: Uint8Array;
	readonly portSlotBodySectionRows: Uint32Array;
	readonly portSlotFaceKinds: Uint8Array;
	/** Packed projected body-section X/Z slot centers. */
	readonly portSlotCenters: Float32Array;
	/** Packed exact authored opening X/Z anchors. */
	readonly portOpeningCenters: Float32Array;
	/** Packed exact authored equipment-facing X/Z normals. */
	readonly portOpeningNormals: Float32Array;
	readonly portSlotHalfLengths: Float32Array;
	readonly portSlotHalfWidths: Float32Array;
	readonly portOpeningHalfHeights: Float32Array;
	readonly byteLength: number;
}

interface PortEquipmentShellGap {
	readonly portRow: number;
	readonly stablePortId: number;
	readonly localStation: number;
	readonly start: number;
	readonly end: number;
}

const SHELL_PRESENTATION_CACHE = new WeakMap<
	CompiledPortEquipmentPresentation,
	CompiledPortEquipmentShellPresentation
>();
const UNIT_VECTOR_TOLERANCE = 1e-4;
const BODY_CONTAINMENT_TOLERANCE_METERS = 1e-3;

/** Lazily retain richer 3D detail by exact immutable base-presentation identity. */
export function portEquipmentShellPresentationFor(
	presentation: CompiledPortEquipmentPresentation,
): CompiledPortEquipmentShellPresentation {
	const cached = SHELL_PRESENTATION_CACHE.get(presentation);
	if (cached) return cached;
	const compiled = compilePortEquipmentShellPresentation(
		presentation,
		portEquipmentInteractionPresentationFor(presentation),
	);
	SHELL_PRESENTATION_CACHE.set(presentation, compiled);
	return compiled;
}

export function compilePortEquipmentShellPresentation(
	presentation: CompiledPortEquipmentPresentation,
	interaction: CompiledPortEquipmentInteractionPresentation = portEquipmentInteractionPresentationFor(
		presentation,
	),
): CompiledPortEquipmentShellPresentation {
	assertPortEquipmentShellSources(presentation, interaction);
	const bodySectionCount = presentation.bodySectionCount;
	const portSlotCount = presentation.count;
	const shellSpanCapacity = bodySectionCount + portSlotCount;
	const shellSpanBodySectionRows = new Uint32Array(shellSpanCapacity);
	const shellSpanEquipmentGroupIds = new Int32Array(shellSpanCapacity);
	const shellSpanKinds = new Uint8Array(shellSpanCapacity);
	const shellSpanCenters = new Float32Array(shellSpanCapacity * 2);
	const shellSpanTangents = new Float32Array(shellSpanCapacity * 2);
	const shellSpanHalfExtents = new Float32Array(shellSpanCapacity * 2);
	const portSlotIds = new Int32Array(portSlotCount);
	const portSlotEquipmentGroupIds = new Int32Array(portSlotCount);
	const portSlotKinds = new Uint8Array(portSlotCount);
	const portSlotBodySectionRows = new Uint32Array(portSlotCount);
	const portSlotFaceKinds = new Uint8Array(portSlotCount);
	const portSlotCenters = new Float32Array(portSlotCount * 2);
	const portOpeningCenters = new Float32Array(portSlotCount * 2);
	const portOpeningNormals = new Float32Array(portSlotCount * 2);
	const portSlotHalfLengths = new Float32Array(portSlotCount);
	const portSlotHalfWidths = new Float32Array(portSlotCount);
	const portOpeningHalfHeights = new Float32Array(portSlotCount);
	const seenPortRows = new Uint8Array(portSlotCount);
	let shellSpanWrite = 0;
	let portSlotWrite = 0;

	for (let sectionRow = 0; sectionRow < bodySectionCount; sectionRow++) {
		const sectionOffset = sectionRow * 2;
		const groupRow = presentation.bodySectionGroupRows[sectionRow] as number;
		const groupId = presentation.groupIds[groupRow] as number;
		const kindRow = presentation.groupKinds[groupRow] as number;
		const centerX = presentation.bodySectionCenters[sectionOffset] as number;
		const centerZ = presentation.bodySectionCenters[sectionOffset + 1] as number;
		const tangentX = presentation.bodySectionTangents[sectionOffset] as number;
		const tangentZ = presentation.bodySectionTangents[sectionOffset + 1] as number;
		const halfLength = presentation.bodySectionHalfExtents[sectionOffset] as number;
		const halfWidth = presentation.bodySectionHalfExtents[sectionOffset + 1] as number;
		assertShellSection(
			groupRow,
			groupId,
			kindRow,
			centerX,
			centerZ,
			tangentX,
			tangentZ,
			halfLength,
			halfWidth,
			presentation.equipmentGroupCount,
		);
		const portRows = Array.from(
			presentation.bodySectionPortRows.subarray(
				presentation.bodySectionPortOffsets[sectionRow] as number,
				presentation.bodySectionPortOffsets[sectionRow + 1] as number,
			),
		).sort(
			(left, right) =>
				(presentation.portIds[left] as number) - (presentation.portIds[right] as number),
		);
		if (portRows.length === 0) {
			throw new TypeError("Port equipment shell body section has no stable port ownership.");
		}
		const gaps: PortEquipmentShellGap[] = [];
		for (const portRow of portRows) {
			if (portRow >= portSlotCount || seenPortRows[portRow] !== 0) {
				throw new TypeError("Port equipment shell port ownership is not an exact partition.");
			}
			seenPortRows[portRow] = 1;
			if (
				(presentation.portBodySectionRows[portRow] as number) !== sectionRow ||
				(presentation.equipmentGroupIds[portRow] as number) !== groupId ||
				(presentation.portTypes[portRow] as number) !== kindRow
			) {
				throw new TypeError("Port equipment shell stable identity mapping is malformed.");
			}
			const openingOffset = portRow * 2;
			const openingX = interaction.portOpeningCenters[openingOffset] as number;
			const openingZ = interaction.portOpeningCenters[openingOffset + 1] as number;
			const normalX = interaction.portOpeningNormals[openingOffset] as number;
			const normalZ = interaction.portOpeningNormals[openingOffset + 1] as number;
			const deltaX = openingX - centerX;
			const deltaZ = openingZ - centerZ;
			const localStation = deltaX * tangentX + deltaZ * tangentZ;
			const localLateral = -deltaX * tangentZ + deltaZ * tangentX;
			if (
				!Number.isFinite(openingX) ||
				!Number.isFinite(openingZ) ||
				!isUnitVector(normalX, normalZ) ||
				Math.abs(localStation) > halfLength + BODY_CONTAINMENT_TOLERANCE_METERS ||
				Math.abs(localLateral) > halfWidth + BODY_CONTAINMENT_TOLERANCE_METERS
			) {
				throw new TypeError("Port equipment shell opening lies outside its exact body section.");
			}
			const clampedStation = Math.max(-halfLength, Math.min(halfLength, localStation));
			const slotHalfLength = Math.min(
				PORT_EQUIPMENT_SHELL_VISUAL_PROFILE.portSlotHalfLengthMetersByKind[kindRow] as number,
				halfLength,
			);
			const faceKind = presentation.portBodyFaceKinds[portRow] as number;
			assertShellFace(faceKind, normalX, normalZ, tangentX, tangentZ);
			gaps.push({
				portRow,
				stablePortId: presentation.portIds[portRow] as number,
				localStation: clampedStation,
				start: Math.max(-halfLength, clampedStation - slotHalfLength),
				end: Math.min(halfLength, clampedStation + slotHalfLength),
			});

			portSlotIds[portSlotWrite] = presentation.portIds[portRow] as number;
			portSlotEquipmentGroupIds[portSlotWrite] = groupId;
			portSlotKinds[portSlotWrite] = kindRow;
			portSlotBodySectionRows[portSlotWrite] = sectionRow;
			portSlotFaceKinds[portSlotWrite] = faceKind;
			portSlotCenters[portSlotWrite * 2] = centerX + tangentX * clampedStation;
			portSlotCenters[portSlotWrite * 2 + 1] = centerZ + tangentZ * clampedStation;
			portOpeningCenters[portSlotWrite * 2] = openingX;
			portOpeningCenters[portSlotWrite * 2 + 1] = openingZ;
			portOpeningNormals[portSlotWrite * 2] = normalX;
			portOpeningNormals[portSlotWrite * 2 + 1] = normalZ;
			portSlotHalfLengths[portSlotWrite] = slotHalfLength;
			portSlotHalfWidths[portSlotWrite] =
				halfWidth *
				(PORT_EQUIPMENT_SHELL_VISUAL_PROFILE.portOpeningWidthRatioByKind[kindRow] as number);
			portOpeningHalfHeights[portSlotWrite] = PORT_EQUIPMENT_SHELL_VISUAL_PROFILE
				.portOpeningHalfHeightMetersByKind[kindRow] as number;
			portSlotWrite++;
		}

		gaps.sort(
			(left, right) =>
				left.start - right.start ||
				left.end - right.end ||
				left.localStation - right.localStation ||
				left.stablePortId - right.stablePortId,
		);
		let spanStart = -halfLength;
		for (const gap of mergeShellGaps(gaps)) {
			shellSpanWrite = writeShellSpan(
				shellSpanWrite,
				spanStart,
				gap.start,
				sectionRow,
				groupId,
				kindRow,
				centerX,
				centerZ,
				tangentX,
				tangentZ,
				halfWidth,
				shellSpanBodySectionRows,
				shellSpanEquipmentGroupIds,
				shellSpanKinds,
				shellSpanCenters,
				shellSpanTangents,
				shellSpanHalfExtents,
			);
			spanStart = Math.max(spanStart, gap.end);
		}
		shellSpanWrite = writeShellSpan(
			shellSpanWrite,
			spanStart,
			halfLength,
			sectionRow,
			groupId,
			kindRow,
			centerX,
			centerZ,
			tangentX,
			tangentZ,
			halfWidth,
			shellSpanBodySectionRows,
			shellSpanEquipmentGroupIds,
			shellSpanKinds,
			shellSpanCenters,
			shellSpanTangents,
			shellSpanHalfExtents,
		);
	}
	if (portSlotWrite !== portSlotCount || seenPortRows.some((seen) => seen !== 1)) {
		throw new TypeError("Port equipment shell did not consume every stable port exactly once.");
	}
	const artifact = {
		policy: PORT_EQUIPMENT_SHELL_PRESENTATION_POLICY,
		revision: presentation.revision,
		bodySectionCount,
		shellSpanCount: shellSpanWrite,
		shellSpanBodySectionRows: shellSpanBodySectionRows.slice(0, shellSpanWrite),
		shellSpanEquipmentGroupIds: shellSpanEquipmentGroupIds.slice(0, shellSpanWrite),
		shellSpanKinds: shellSpanKinds.slice(0, shellSpanWrite),
		shellSpanCenters: shellSpanCenters.slice(0, shellSpanWrite * 2),
		shellSpanTangents: shellSpanTangents.slice(0, shellSpanWrite * 2),
		shellSpanHalfExtents: shellSpanHalfExtents.slice(0, shellSpanWrite * 2),
		portSlotCount,
		portSlotIds,
		portSlotEquipmentGroupIds,
		portSlotKinds,
		portSlotBodySectionRows,
		portSlotFaceKinds,
		portSlotCenters,
		portOpeningCenters,
		portOpeningNormals,
		portSlotHalfLengths,
		portSlotHalfWidths,
		portOpeningHalfHeights,
	};
	return Object.freeze({
		...artifact,
		byteLength: shellPresentationByteLength(artifact),
	});
}

function assertPortEquipmentShellSources(
	presentation: CompiledPortEquipmentPresentation,
	interaction: CompiledPortEquipmentInteractionPresentation,
): void {
	const portCount = presentation.count;
	const sectionCount = presentation.bodySectionCount;
	if (
		!Number.isSafeInteger(presentation.revision) ||
		presentation.revision < 0 ||
		!Number.isSafeInteger(portCount) ||
		portCount < 0 ||
		!Number.isSafeInteger(sectionCount) ||
		sectionCount < 0 ||
		interaction.revision !== presentation.revision ||
		interaction.count !== portCount ||
		presentation.portIds.length !== portCount ||
		presentation.equipmentGroupIds.length !== portCount ||
		presentation.portTypes.length !== portCount ||
		presentation.portBodySectionRows.length !== portCount ||
		presentation.portBodyFaceKinds.length !== portCount ||
		presentation.groupIds.length !== presentation.equipmentGroupCount ||
		presentation.groupKinds.length !== presentation.equipmentGroupCount ||
		presentation.bodySectionGroupRows.length !== sectionCount ||
		presentation.bodySectionCenters.length !== sectionCount * 2 ||
		presentation.bodySectionTangents.length !== sectionCount * 2 ||
		presentation.bodySectionHalfExtents.length !== sectionCount * 2 ||
		presentation.bodySectionPortOffsets.length !== sectionCount + 1 ||
		presentation.bodySectionPortRows.length !== portCount ||
		interaction.portOpeningCenters.length !== portCount * 2 ||
		interaction.portOpeningNormals.length !== portCount * 2
	) {
		throw new TypeError("Port equipment shell source arrays are malformed.");
	}
	if (
		(presentation.bodySectionPortOffsets[0] as number) !== 0 ||
		(presentation.bodySectionPortOffsets[sectionCount] as number) !== portCount
	) {
		throw new TypeError("Port equipment shell source CSR is malformed.");
	}
	for (let row = 0; row < sectionCount; row++) {
		if (
			(presentation.bodySectionPortOffsets[row] as number) >
			(presentation.bodySectionPortOffsets[row + 1] as number)
		) {
			throw new TypeError("Port equipment shell source CSR is not monotonic.");
		}
	}
}

function assertShellSection(
	groupRow: number,
	groupId: number,
	kindRow: number,
	centerX: number,
	centerZ: number,
	tangentX: number,
	tangentZ: number,
	halfLength: number,
	halfWidth: number,
	groupCount: number,
): void {
	if (
		groupRow >= groupCount ||
		!Number.isSafeInteger(groupId) ||
		groupId <= 0 ||
		kindRow < 0 ||
		kindRow >= EQUIPMENT_GROUP_KINDS.length ||
		kindRow >= PORT_TYPES.length ||
		!Number.isFinite(centerX) ||
		!Number.isFinite(centerZ) ||
		!isUnitVector(tangentX, tangentZ) ||
		!Number.isFinite(halfLength) ||
		halfLength <= 0 ||
		!Number.isFinite(halfWidth) ||
		halfWidth <= 0
	) {
		throw new TypeError("Port equipment shell body section is malformed.");
	}
}

function assertShellFace(
	faceKind: number,
	normalX: number,
	normalZ: number,
	tangentX: number,
	tangentZ: number,
): void {
	if (faceKind === PORT_EQUIPMENT_BODY_FACE_KIND.UNKNOWN) return;
	const alignment = normalX * tangentX + normalZ * tangentZ;
	if (
		(faceKind !== PORT_EQUIPMENT_BODY_FACE_KIND.WITH_SECTION_TANGENT &&
			faceKind !== PORT_EQUIPMENT_BODY_FACE_KIND.AGAINST_SECTION_TANGENT) ||
		Math.abs(
			alignment - (faceKind === PORT_EQUIPMENT_BODY_FACE_KIND.WITH_SECTION_TANGENT ? 1 : -1),
		) > UNIT_VECTOR_TOLERANCE
	) {
		throw new TypeError("Port equipment shell opening face is malformed.");
	}
}

function mergeShellGaps(
	gaps: readonly PortEquipmentShellGap[],
): readonly Readonly<{ start: number; end: number }>[] {
	const merged: { start: number; end: number }[] = [];
	for (const gap of gaps) {
		const last = merged.at(-1);
		if (!last || gap.start > last.end) {
			merged.push({ start: gap.start, end: gap.end });
		} else {
			last.end = Math.max(last.end, gap.end);
		}
	}
	return merged;
}

function writeShellSpan(
	write: number,
	start: number,
	end: number,
	sectionRow: number,
	groupId: number,
	kindRow: number,
	centerX: number,
	centerZ: number,
	tangentX: number,
	tangentZ: number,
	halfWidth: number,
	sectionRows: Uint32Array,
	groupIds: Int32Array,
	kinds: Uint8Array,
	centers: Float32Array,
	tangents: Float32Array,
	halfExtents: Float32Array,
): number {
	const halfLength = (end - start) / 2;
	if (halfLength < PORT_EQUIPMENT_SHELL_VISUAL_PROFILE.minimumShellSpanHalfLengthMeters) {
		return write;
	}
	const localCenter = (start + end) / 2;
	sectionRows[write] = sectionRow;
	groupIds[write] = groupId;
	kinds[write] = kindRow;
	centers[write * 2] = centerX + tangentX * localCenter;
	centers[write * 2 + 1] = centerZ + tangentZ * localCenter;
	tangents[write * 2] = tangentX;
	tangents[write * 2 + 1] = tangentZ;
	halfExtents[write * 2] = halfLength;
	halfExtents[write * 2 + 1] = halfWidth;
	return write + 1;
}

function shellPresentationByteLength(
	artifact: Omit<CompiledPortEquipmentShellPresentation, "byteLength">,
): number {
	return (
		artifact.shellSpanBodySectionRows.byteLength +
		artifact.shellSpanEquipmentGroupIds.byteLength +
		artifact.shellSpanKinds.byteLength +
		artifact.shellSpanCenters.byteLength +
		artifact.shellSpanTangents.byteLength +
		artifact.shellSpanHalfExtents.byteLength +
		artifact.portSlotIds.byteLength +
		artifact.portSlotEquipmentGroupIds.byteLength +
		artifact.portSlotKinds.byteLength +
		artifact.portSlotBodySectionRows.byteLength +
		artifact.portSlotFaceKinds.byteLength +
		artifact.portSlotCenters.byteLength +
		artifact.portOpeningCenters.byteLength +
		artifact.portOpeningNormals.byteLength +
		artifact.portSlotHalfLengths.byteLength +
		artifact.portSlotHalfWidths.byteLength +
		artifact.portOpeningHalfHeights.byteLength
	);
}

function isUnitVector(x: number, z: number): boolean {
	return (
		Number.isFinite(x) &&
		Number.isFinite(z) &&
		Math.abs(Math.hypot(x, z) - 1) <= UNIT_VECTOR_TOLERANCE
	);
}
