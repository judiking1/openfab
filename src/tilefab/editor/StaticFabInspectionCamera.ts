export interface StaticFabInspectionBounds3D {
	readonly minX: number;
	readonly minY: number;
	readonly minZ: number;
	readonly maxX: number;
	readonly maxY: number;
	readonly maxZ: number;
}

export interface StaticFabInspectionCameraPose {
	readonly targetX: number;
	readonly targetY: number;
	readonly targetZ: number;
	readonly positionX: number;
	readonly positionY: number;
	readonly positionZ: number;
	readonly distance: number;
	readonly near: number;
	readonly far: number;
	readonly minimumDistance: number;
	readonly maximumDistance: number;
}

export type StaticFabInspectionCameraPreset = "isometric" | "top";

const DEFAULT_AZIMUTH_RADIANS = (-45 * Math.PI) / 180;
const DEFAULT_ELEVATION_RADIANS = (40 * Math.PI) / 180;
const TOP_ELEVATION_RADIANS = (80 * Math.PI) / 180;
const FIT_PADDING = 1.18;

const MINIMUM_RAIL_PICK_THRESHOLD_METERS = 0.25;
const MAXIMUM_RAIL_PICK_THRESHOLD_METERS = 2.5;
const DEFAULT_RAIL_PICK_TARGET_PIXELS = 6;

/** Conservative perspective fit that remains valid for every orbit orientation around the target. */
export function fitStaticFabInspectionCamera(
	bounds: StaticFabInspectionBounds3D,
	aspect: number,
	verticalFieldOfViewDegrees: number,
	preset: StaticFabInspectionCameraPreset = "isometric",
	focus?: Readonly<{ x: number; z: number }>,
): StaticFabInspectionCameraPose {
	assertFiniteBounds(bounds);
	if (!Number.isFinite(aspect) || aspect <= 0)
		throw new RangeError("3D camera aspect must be positive.");
	if (
		!Number.isFinite(verticalFieldOfViewDegrees) ||
		verticalFieldOfViewDegrees < 10 ||
		verticalFieldOfViewDegrees > 100
	) {
		throw new RangeError("3D camera field of view must be within 10..100 degrees.");
	}

	const spanX = Math.max(0.1, bounds.maxX - bounds.minX);
	const spanY = Math.max(0.1, bounds.maxY - bounds.minY);
	const spanZ = Math.max(0.1, bounds.maxZ - bounds.minZ);
	const radius = Math.max(0.5, Math.hypot(spanX, spanY, spanZ) / 2);
	const verticalHalfFov = (verticalFieldOfViewDegrees * Math.PI) / 360;
	const horizontalHalfFov = Math.atan(Math.tan(verticalHalfFov) * aspect);
	const limitingHalfFov = Math.max(0.05, Math.min(verticalHalfFov, horizontalHalfFov));
	const distance = (radius / Math.sin(limitingHalfFov)) * FIT_PADDING;
	const targetX = focus?.x ?? (bounds.minX + bounds.maxX) / 2;
	const targetY = (bounds.minY + bounds.maxY) / 2;
	const targetZ = focus?.z ?? (bounds.minZ + bounds.maxZ) / 2;
	const elevation = preset === "top" ? TOP_ELEVATION_RADIANS : DEFAULT_ELEVATION_RADIANS;
	const azimuth = preset === "top" ? -Math.PI / 2 : DEFAULT_AZIMUTH_RADIANS;
	const horizontalDistance = Math.cos(elevation) * distance;
	const positionX = targetX + Math.cos(azimuth) * horizontalDistance;
	const positionY = targetY + Math.sin(elevation) * distance;
	const positionZ = targetZ + Math.sin(azimuth) * horizontalDistance;
	return Object.freeze({
		targetX,
		targetY,
		targetZ,
		positionX,
		positionY,
		positionZ,
		distance,
		near: Math.max(0.02, distance - radius * 2.5),
		far: Math.max(100, distance + radius * 4),
		minimumDistance: Math.max(0.5, radius * 0.08),
		maximumDistance: Math.max(25, radius * 18),
	});
}

export function bounds3DFromArray(bounds: ArrayLike<number>): StaticFabInspectionBounds3D {
	if (bounds.length !== 6) throw new RangeError("3D bounds must contain six values.");
	const result = Object.freeze({
		minX: bounds[0] as number,
		minY: bounds[1] as number,
		minZ: bounds[2] as number,
		maxX: bounds[3] as number,
		maxY: bounds[4] as number,
		maxZ: bounds[5] as number,
	});
	assertFiniteBounds(result);
	return result;
}

/** Converts a stable screen-space rail hit target into the Raycaster's world-space threshold. */
export function staticFabInspectionRailPickThreshold(
	cameraDistance: number,
	verticalFieldOfViewDegrees: number,
	viewportHeightPixels: number,
	targetPixels = DEFAULT_RAIL_PICK_TARGET_PIXELS,
): number {
	if (!Number.isFinite(cameraDistance) || cameraDistance <= 0) {
		throw new RangeError("3D pick camera distance must be positive.");
	}
	if (
		!Number.isFinite(verticalFieldOfViewDegrees) ||
		verticalFieldOfViewDegrees < 10 ||
		verticalFieldOfViewDegrees > 100
	) {
		throw new RangeError("3D pick field of view must be within 10..100 degrees.");
	}
	if (!Number.isFinite(viewportHeightPixels) || viewportHeightPixels <= 0) {
		throw new RangeError("3D pick viewport height must be positive.");
	}
	if (!Number.isFinite(targetPixels) || targetPixels <= 0) {
		throw new RangeError("3D pick target pixels must be positive.");
	}
	const verticalFieldOfViewRadians = (verticalFieldOfViewDegrees * Math.PI) / 180;
	const visibleWorldHeight = 2 * cameraDistance * Math.tan(verticalFieldOfViewRadians / 2);
	return Math.min(
		MAXIMUM_RAIL_PICK_THRESHOLD_METERS,
		Math.max(
			MINIMUM_RAIL_PICK_THRESHOLD_METERS,
			(visibleWorldHeight / viewportHeightPixels) * targetPixels,
		),
	);
}

function assertFiniteBounds(bounds: StaticFabInspectionBounds3D): void {
	const values = [bounds.minX, bounds.minY, bounds.minZ, bounds.maxX, bounds.maxY, bounds.maxZ];
	if (!values.every(Number.isFinite)) throw new RangeError("3D bounds must be finite.");
	if (bounds.maxX < bounds.minX || bounds.maxY < bounds.minY || bounds.maxZ < bounds.minZ) {
		throw new RangeError("3D bounds are inverted.");
	}
}
