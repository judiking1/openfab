export type BlueprintPlacementOrigin =
	| "selection-copy"
	| "recent"
	| "library"
	| "favorite"
	| "assembly-pattern"
	| "fab-preset";

export type BlueprintPlacementSource = "blueprint" | "assembly-pattern";

export interface BlueprintPlacementBounds {
	readonly minX: number;
	readonly minY: number;
	readonly maxX: number;
	readonly maxY: number;
}

export interface BlueprintPlacementRotationPivot {
	readonly centerXTwice: number;
	readonly centerYTwice: number;
	readonly anchor: Readonly<{ x: number; y: number }>;
	readonly quarterTurns: number;
}

export interface BlueprintPlacementRotation {
	readonly anchor: Readonly<{ x: number; y: number }>;
	readonly pivot: BlueprintPlacementRotationPivot;
}

export function blueprintPlacementSource(
	origin: BlueprintPlacementOrigin,
): BlueprintPlacementSource {
	return origin === "assembly-pattern" ? "assembly-pattern" : "blueprint";
}

export function blueprintPlacementStatusPrefix(origin: BlueprintPlacementOrigin): string {
	switch (origin) {
		case "recent":
			return "최근 복사 · ";
		case "favorite":
			return "즐겨찾기 · ";
		case "library":
			return "내 청사진 · ";
		case "assembly-pattern":
			return "FAB ASSEMBLY · ";
		case "fab-preset":
			return "FAB PRESET · ";
		case "selection-copy":
			return "";
	}
}

export function blueprintPlacementCapturesRecent(origin: BlueprintPlacementOrigin): boolean {
	return origin === "selection-copy";
}

export function shouldRetainPlacementGhostOnPointerLeave(input: {
	readonly areaStampActive: boolean;
	readonly moduleStampActive: boolean;
	readonly templatePlacementActive: boolean;
}): boolean {
	return input.areaStampActive || input.moduleStampActive || input.templatePlacementActive;
}

export function blueprintPlacementAnchorAtWorldCenter(
	bounds: BlueprintPlacementBounds,
	worldCenter: Readonly<{ x: number; y: number }>,
): Readonly<{ x: number; y: number }> {
	return Object.freeze({
		x: Math.round(worldCenter.x - (bounds.minX + bounds.maxX + 1) / 2),
		y: Math.round(worldCenter.y - (bounds.minY + bounds.maxY + 1) / 2),
	});
}

export function blueprintPlacementWorldCenterAtAnchor(
	bounds: BlueprintPlacementBounds,
	anchor: Readonly<{ x: number; y: number }>,
): Readonly<{ x: number; y: number }> {
	return Object.freeze({
		x: anchor.x + (bounds.minX + bounds.maxX + 1) / 2,
		y: anchor.y + (bounds.minY + bounds.maxY + 1) / 2,
	});
}

export function rotateBlueprintPlacementAroundStableCenter(input: {
	readonly currentAnchor: Readonly<{ x: number; y: number }>;
	readonly currentBounds: BlueprintPlacementBounds;
	readonly currentQuarterTurns: number;
	readonly nextBounds: BlueprintPlacementBounds;
	readonly nextQuarterTurns: number;
	readonly previousPivot: BlueprintPlacementRotationPivot | null;
}): BlueprintPlacementRotation {
	const reusablePivot =
		input.previousPivot?.quarterTurns === input.currentQuarterTurns &&
		input.previousPivot.anchor.x === input.currentAnchor.x &&
		input.previousPivot.anchor.y === input.currentAnchor.y
			? input.previousPivot
			: null;
	const centerXTwice =
		reusablePivot?.centerXTwice ??
		input.currentAnchor.x * 2 + input.currentBounds.minX + input.currentBounds.maxX + 1;
	const centerYTwice =
		reusablePivot?.centerYTwice ??
		input.currentAnchor.y * 2 + input.currentBounds.minY + input.currentBounds.maxY + 1;
	const anchor = Object.freeze({
		x: Math.round((centerXTwice - input.nextBounds.minX - input.nextBounds.maxX - 1) / 2),
		y: Math.round((centerYTwice - input.nextBounds.minY - input.nextBounds.maxY - 1) / 2),
	});
	return Object.freeze({
		anchor,
		pivot: Object.freeze({
			centerXTwice,
			centerYTwice,
			anchor,
			quarterTurns: input.nextQuarterTurns,
		}),
	});
}
