export interface StaticFabMinimapWorldBounds {
	readonly minX: number;
	readonly minY: number;
	readonly maxX: number;
	readonly maxY: number;
}

export interface StaticFabMinimapPoint {
	readonly x: number;
	readonly y: number;
}

export interface StaticFabMinimapRect {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

export interface StaticFabMinimapTransform {
	readonly worldBounds: StaticFabMinimapWorldBounds;
	readonly width: number;
	readonly height: number;
	readonly scale: number;
	readonly offsetX: number;
	readonly offsetY: number;
	readonly content: StaticFabMinimapRect;
}

export function createStaticFabMinimapTransform(
	worldBounds: StaticFabMinimapWorldBounds,
	width: number,
	height: number,
	padding = 8,
): StaticFabMinimapTransform {
	assertFiniteBounds(worldBounds);
	if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
		throw new RangeError("minimap dimensions must be finite and positive");
	}
	if (!Number.isFinite(padding) || padding < 0) {
		throw new RangeError("minimap padding must be finite and non-negative");
	}
	const boundedPadding = Math.min(padding, Math.max(0, Math.min(width, height) * 0.5 - 0.5));
	const availableWidth = Math.max(1, width - boundedPadding * 2);
	const availableHeight = Math.max(1, height - boundedPadding * 2);
	const worldWidth = Math.max(Number.EPSILON, worldBounds.maxX - worldBounds.minX);
	const worldHeight = Math.max(Number.EPSILON, worldBounds.maxY - worldBounds.minY);
	const scale = Math.min(availableWidth / worldWidth, availableHeight / worldHeight);
	const contentWidth = worldWidth * scale;
	const contentHeight = worldHeight * scale;
	const contentX = (width - contentWidth) * 0.5;
	const contentY = (height - contentHeight) * 0.5;
	return Object.freeze({
		worldBounds: Object.freeze({ ...worldBounds }),
		width,
		height,
		scale,
		offsetX: contentX - worldBounds.minX * scale,
		offsetY: contentY - worldBounds.minY * scale,
		content: Object.freeze({
			x: contentX,
			y: contentY,
			width: contentWidth,
			height: contentHeight,
		}),
	});
}

export function staticFabMinimapPointAtWorld(
	transform: StaticFabMinimapTransform,
	world: StaticFabMinimapPoint,
): StaticFabMinimapPoint {
	return Object.freeze({
		x: world.x * transform.scale + transform.offsetX,
		y: world.y * transform.scale + transform.offsetY,
	});
}

export function staticFabMinimapWorldAtPoint(
	transform: StaticFabMinimapTransform,
	point: StaticFabMinimapPoint,
	clampToWorld = true,
): StaticFabMinimapPoint {
	const x = (point.x - transform.offsetX) / transform.scale;
	const y = (point.y - transform.offsetY) / transform.scale;
	return Object.freeze({
		x: clampToWorld ? clamp(x, transform.worldBounds.minX, transform.worldBounds.maxX) : x,
		y: clampToWorld ? clamp(y, transform.worldBounds.minY, transform.worldBounds.maxY) : y,
	});
}

export function staticFabMinimapRectForWorldBounds(
	transform: StaticFabMinimapTransform,
	bounds: StaticFabMinimapWorldBounds,
): StaticFabMinimapRect {
	assertFiniteBounds(bounds);
	const minX = Math.max(transform.worldBounds.minX, bounds.minX);
	const minY = Math.max(transform.worldBounds.minY, bounds.minY);
	const maxX = Math.min(transform.worldBounds.maxX, bounds.maxX);
	const maxY = Math.min(transform.worldBounds.maxY, bounds.maxY);
	if (maxX <= minX || maxY <= minY) {
		const nearest = staticFabMinimapPointAtWorld(transform, {
			x: clamp(
				(bounds.minX + bounds.maxX) * 0.5,
				transform.worldBounds.minX,
				transform.worldBounds.maxX,
			),
			y: clamp(
				(bounds.minY + bounds.maxY) * 0.5,
				transform.worldBounds.minY,
				transform.worldBounds.maxY,
			),
		});
		return Object.freeze({ x: nearest.x, y: nearest.y, width: 0, height: 0 });
	}
	const start = staticFabMinimapPointAtWorld(transform, {
		x: minX,
		y: minY,
	});
	const end = staticFabMinimapPointAtWorld(transform, {
		x: maxX,
		y: maxY,
	});
	return Object.freeze({
		x: start.x,
		y: start.y,
		width: end.x - start.x,
		height: end.y - start.y,
	});
}

function assertFiniteBounds(bounds: StaticFabMinimapWorldBounds): void {
	if (
		!Number.isFinite(bounds.minX) ||
		!Number.isFinite(bounds.minY) ||
		!Number.isFinite(bounds.maxX) ||
		!Number.isFinite(bounds.maxY) ||
		bounds.maxX <= bounds.minX ||
		bounds.maxY <= bounds.minY
	) {
		throw new RangeError("minimap bounds must be finite and non-empty");
	}
}

function clamp(value: number, minimum: number, maximum: number): number {
	return Math.min(maximum, Math.max(minimum, value));
}
