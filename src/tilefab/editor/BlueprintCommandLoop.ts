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

export interface BlueprintPlacementLifecycle {
	readonly mode: "single" | "repeat";
	readonly exitIsCancellation: boolean;
	readonly modeLabel: string;
	readonly primaryActionLabel: string;
}

export type ModuleStampRepeatPolicy =
	| "single"
	| "from-output"
	| "compatible-anchor"
	| "choose-output";

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

/** Large FAB presets are one-shot by default; Shift+placement opts into the expert repeat loop. */
export function blueprintPlacementUsesSingleCommitByDefault(
	origin: BlueprintPlacementOrigin,
): boolean {
	return origin === "fab-preset";
}

/**
 * Derive visible transient placement state from the same origin policy that controls commit exit.
 * A preset can remain held only after an explicit repeat gesture has committed at least once.
 */
export function blueprintPlacementLifecycle(
	origin: BlueprintPlacementOrigin,
	committedCount = 0,
): BlueprintPlacementLifecycle {
	const single = blueprintPlacementUsesSingleCommitByDefault(origin) && committedCount === 0;
	return Object.freeze({
		mode: single ? "single" : "repeat",
		exitIsCancellation: committedCount === 0,
		modeLabel: single ? "1회 배치 · Shift+클릭 시 계속" : "반복 배치 중",
		primaryActionLabel: single ? "여기에 1회 배치" : "여기에 배치",
	});
}

/** A switch hands off to output selection; like a single stamp, it does not retain the ghost. */
export function moduleStampUsesSingleCommit(policy: ModuleStampRepeatPolicy): boolean {
	return policy === "single" || policy === "choose-output";
}

export function blueprintPlacementCompactIdentity(input: {
	readonly origin: BlueprintPlacementOrigin;
	readonly sourceModuleCount: number;
	readonly equipmentGroupCount: number;
	readonly portCount: number;
}): string {
	const source = (() => {
		switch (input.origin) {
			case "selection-copy":
				return "COPY";
			case "recent":
				return "RECENT";
			case "library":
			case "favorite":
				return "BLUEPRINT";
			case "assembly-pattern":
				return "ASSEMBLY";
			case "fab-preset":
				return "FAB PRESET";
		}
	})();
	const details = [`${input.sourceModuleCount.toLocaleString()} RAIL`];
	if (input.equipmentGroupCount > 0) {
		details.push(
			`${input.equipmentGroupCount.toLocaleString()} ${input.equipmentGroupCount === 1 ? "GROUP" : "GROUPS"}`,
		);
	}
	if (input.portCount > 0) {
		details.push(`${input.portCount.toLocaleString()} ${input.portCount === 1 ? "PORT" : "PORTS"}`);
	}
	return `${source} ${details.join(" · ")}`;
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
