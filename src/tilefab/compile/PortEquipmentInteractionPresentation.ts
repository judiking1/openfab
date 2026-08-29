import {
	type CompiledPortEquipmentPresentation,
	PORT_EQUIPMENT_BODY_FACE_KIND,
} from "./PortEquipmentPresentation";

export const PORT_EQUIPMENT_PORT_PICK_RADIUS_METERS = 0.28;

export interface CompiledPortEquipmentInteractionPresentation {
	readonly revision: number;
	readonly count: number;
	/** Renderer-neutral world x/z opening anchors, row-aligned with stable ports. */
	readonly portOpeningCenters: Float32Array;
	/** Unit world x/z equipment-facing vectors, row-aligned with stable ports. */
	readonly portOpeningNormals: Float32Array;
	/** World-space minX, minZ, maxX, maxZ for each stable port pick proxy. */
	readonly portPickBounds: Float32Array;
	readonly byteLength: number;
}

const INTERACTION_PRESENTATION_CACHE = new WeakMap<
	CompiledPortEquipmentPresentation,
	CompiledPortEquipmentInteractionPresentation
>();

/** Lazily retain 3D interaction detail by exact immutable base-presentation identity. */
export function portEquipmentInteractionPresentationFor(
	presentation: CompiledPortEquipmentPresentation,
): CompiledPortEquipmentInteractionPresentation {
	const cached = INTERACTION_PRESENTATION_CACHE.get(presentation);
	if (cached) return cached;
	const compiled = compilePortEquipmentInteractionPresentation(presentation);
	INTERACTION_PRESENTATION_CACHE.set(presentation, compiled);
	return compiled;
}

export function compilePortEquipmentInteractionPresentation(
	presentation: CompiledPortEquipmentPresentation,
): CompiledPortEquipmentInteractionPresentation {
	const count = presentation.count;
	if (
		presentation.worldPositions.length !== count * 2 ||
		presentation.yawRadians.length !== count ||
		presentation.portBodySectionRows.length !== count ||
		presentation.portBodyFaceKinds.length !== count ||
		presentation.bodySectionPortOffsets.length !== presentation.bodySectionCount + 1 ||
		presentation.bodySectionPortRows.length !== count
	) {
		throw new TypeError("Port equipment interaction source arrays are malformed.");
	}
	const portOpeningCenters = new Float32Array(presentation.worldPositions);
	const portOpeningNormals = new Float32Array(count * 2);
	const portPickBounds = new Float32Array(count * 4);
	for (let portRow = 0; portRow < count; portRow++) {
		const bodySectionRow = presentation.portBodySectionRows[portRow] as number;
		const faceKind = presentation.portBodyFaceKinds[portRow] as number;
		if (
			bodySectionRow >= presentation.bodySectionCount ||
			(faceKind !== PORT_EQUIPMENT_BODY_FACE_KIND.WITH_SECTION_TANGENT &&
				faceKind !== PORT_EQUIPMENT_BODY_FACE_KIND.AGAINST_SECTION_TANGENT &&
				faceKind !== PORT_EQUIPMENT_BODY_FACE_KIND.UNKNOWN)
		) {
			throw new TypeError("Port equipment interaction mapping is malformed.");
		}
		// UNKNOWN preserves the authored equipment-facing vector as a repair/display anchor; it does
		// not claim that this anchor is aligned to a certified body face.
		const normalX = Math.cos(presentation.yawRadians[portRow] as number);
		const normalZ = Math.sin(presentation.yawRadians[portRow] as number);
		portOpeningNormals[portRow * 2] = normalX;
		portOpeningNormals[portRow * 2 + 1] = normalZ;
		const worldX = presentation.worldPositions[portRow * 2] as number;
		const worldZ = presentation.worldPositions[portRow * 2 + 1] as number;
		portPickBounds[portRow * 4] = worldX - PORT_EQUIPMENT_PORT_PICK_RADIUS_METERS;
		portPickBounds[portRow * 4 + 1] = worldZ - PORT_EQUIPMENT_PORT_PICK_RADIUS_METERS;
		portPickBounds[portRow * 4 + 2] = worldX + PORT_EQUIPMENT_PORT_PICK_RADIUS_METERS;
		portPickBounds[portRow * 4 + 3] = worldZ + PORT_EQUIPMENT_PORT_PICK_RADIUS_METERS;
	}
	return Object.freeze({
		revision: presentation.revision,
		count,
		portOpeningCenters,
		portOpeningNormals,
		portPickBounds,
		byteLength:
			portOpeningCenters.byteLength + portOpeningNormals.byteLength + portPickBounds.byteLength,
	});
}
