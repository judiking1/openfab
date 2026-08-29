import {
	prepareStaticFabOrganizationBundle,
	type StaticFabOrganizationBundle,
	type StaticFabOrganizationBundleQuarterTurns,
	type StaticFabOrganizationBundleSourceBounds,
} from "../core/StaticFabOrganizationBundle";
import { staticFabOrganizationBundleFingerprint } from "../core/StaticFabOrganizationBundlePlacement";
import type { Cell } from "../core/TileMap";
import {
	type BlueprintPlacementOrigin,
	blueprintPlacementAnchorAtWorldCenter,
} from "./BlueprintCommandLoop";

export type StaticFabOrganizationBundleRotationDegrees = 0 | 90 | 180 | 270;

export interface StaticFabOrganizationBundlePlacementSessionMetadata {
	readonly label: string;
	readonly origin: BlueprintPlacementOrigin;
	readonly quarterTurns?: StaticFabOrganizationBundleQuarterTurns;
	readonly sourceBounds?: StaticFabOrganizationBundleSourceBounds | null;
}

export interface StaticFabOrganizationBundlePlacementSessionSummary {
	readonly label: string;
	readonly origin: BlueprintPlacementOrigin;
	readonly captureMode: StaticFabOrganizationBundle["captureMode"];
	readonly quarterTurns: StaticFabOrganizationBundleQuarterTurns;
	readonly rotationDegrees: StaticFabOrganizationBundleRotationDegrees;
	readonly widthMeters: number;
	readonly heightMeters: number;
	readonly sourceModuleCount: number;
	readonly railEdgeCount: number;
	readonly advancedSwitchCount: number;
	readonly portCount: number;
	readonly equipmentGroupCount: number;
	readonly organizationCount: number;
	readonly rootOrganizationCount: number;
}

export interface StaticFabOrganizationBundlePlacementBounds {
	readonly minX: number;
	readonly minY: number;
	readonly maxX: number;
	readonly maxY: number;
}

export interface StaticFabOrganizationBundlePlacementAlignment {
	readonly anchor: Readonly<Cell>;
	readonly centerX: boolean;
	readonly centerY: boolean;
}

const ORGANIZATION_BUNDLE_ALIGNMENT_SNAP_METERS = 2;
const ORGANIZATION_BUNDLE_ADJACENT_GAP_METERS = 8;

/** Pure immutable UI session over one prepared portable organization bundle. */
export class StaticFabOrganizationBundlePlacementSession {
	readonly bundle: StaticFabOrganizationBundle;
	readonly bundleFingerprint: string;
	readonly label: string;
	readonly origin: BlueprintPlacementOrigin;
	readonly sourceBounds: StaticFabOrganizationBundleSourceBounds | null;
	readonly quarterTurns: StaticFabOrganizationBundleQuarterTurns;
	readonly rotationDegrees: StaticFabOrganizationBundleRotationDegrees;
	readonly bounds: StaticFabOrganizationBundlePlacementBounds;
	readonly widthMeters: number;
	readonly heightMeters: number;
	readonly summary: StaticFabOrganizationBundlePlacementSessionSummary;

	constructor(bundleInput: unknown, metadata: StaticFabOrganizationBundlePlacementSessionMetadata) {
		const prepared = prepareStaticFabOrganizationBundle(bundleInput);
		if (!prepared.valid) {
			throw new TypeError(`Invalid static FAB organization bundle: ${prepared.reason}`);
		}
		if (typeof metadata.label !== "string" || metadata.label.trim().length === 0) {
			throw new TypeError("Organization bundle placement label must not be empty");
		}
		const quarterTurns = metadata.quarterTurns ?? 0;
		if (!isQuarterTurns(quarterTurns)) {
			throw new RangeError("Organization bundle rotation must be 0, 1, 2, or 3 quarter turns");
		}
		const sourceBounds = prepareSourceBounds(metadata.sourceBounds);

		const bounds = rotatedPlacementBounds(
			prepared.bundle.sourceWidthMeters,
			prepared.bundle.sourceHeightMeters,
			quarterTurns,
		);
		const widthMeters = bounds.maxX - bounds.minX;
		const heightMeters = bounds.maxY - bounds.minY;
		const rotationDegrees = rotationDegreesFor(quarterTurns);

		this.bundle = prepared.bundle;
		this.bundleFingerprint = staticFabOrganizationBundleFingerprint(prepared.bundle);
		this.label = metadata.label;
		this.origin = metadata.origin;
		this.sourceBounds = sourceBounds;
		this.quarterTurns = quarterTurns;
		this.rotationDegrees = rotationDegrees;
		this.bounds = bounds;
		this.widthMeters = widthMeters;
		this.heightMeters = heightMeters;
		this.summary = Object.freeze({
			label: metadata.label,
			origin: metadata.origin,
			captureMode: prepared.bundle.captureMode,
			quarterTurns,
			rotationDegrees,
			widthMeters,
			heightMeters,
			sourceModuleCount: prepared.bundle.sourceModuleCount,
			railEdgeCount: prepared.bundle.railEdges.length,
			advancedSwitchCount: prepared.bundle.advancedSwitches.length,
			portCount: prepared.bundle.ports.length,
			equipmentGroupCount: prepared.bundle.equipmentGroups.length,
			organizationCount: prepared.bundle.organizations.length,
			rootOrganizationCount: prepared.bundle.rootOrganizationIndices.length,
		});
		Object.freeze(this);
	}

	rotate(deltaQuarterTurns: -1 | 1): StaticFabOrganizationBundlePlacementSession {
		if (deltaQuarterTurns !== -1 && deltaQuarterTurns !== 1) {
			throw new RangeError("Organization bundle rotation delta must be -1 or 1 quarter turn");
		}
		const quarterTurns = ((this.quarterTurns + deltaQuarterTurns + 4) %
			4) as StaticFabOrganizationBundleQuarterTurns;
		return new StaticFabOrganizationBundlePlacementSession(this.bundle, {
			label: this.label,
			origin: this.origin,
			quarterTurns,
			sourceBounds: this.sourceBounds,
		});
	}

	/** Keeps the pointer on the geometric center and magnetizes an immediate copy to source axes. */
	anchorAtPointerCell(pointer: Cell): Readonly<Cell> {
		const rawAnchor = blueprintPlacementAnchorAtWorldCenter(this.bounds, {
			x: pointer.x + 0.5,
			y: pointer.y + 0.5,
		});
		return this.snapAnchorToSourceAxes(rawAnchor).anchor;
	}

	/** Describe exact source-center alignment for renderer guidance and semantic UI telemetry. */
	alignmentAtAnchor(anchor: Cell): StaticFabOrganizationBundlePlacementAlignment {
		const source = this.sourceBounds;
		return Object.freeze({
			anchor: Object.freeze({ x: anchor.x, y: anchor.y }),
			centerX:
				source !== null &&
				anchor.x * 2 + this.bounds.minX + this.bounds.maxX + 1 === source.minX + source.maxX + 1,
			centerY:
				source !== null &&
				anchor.y * 2 + this.bounds.minY + this.bounds.maxY + 1 === source.minY + source.maxY + 1,
		});
	}

	/**
	 * Four deterministic, non-overlapping starting positions around an immediate-copy source.
	 * Callers may cheaply preview them and choose the first collision-free candidate.
	 */
	adjacentPlacementAnchors(
		gapMeters = ORGANIZATION_BUNDLE_ADJACENT_GAP_METERS,
	): readonly Readonly<Cell>[] {
		const source = this.sourceBounds;
		if (!source || !Number.isSafeInteger(gapMeters) || gapMeters < 0) return Object.freeze([]);
		const centeredX = nearestIntegerAnchor(
			source.minX + source.maxX + 1,
			this.bounds.minX + this.bounds.maxX + 1,
		);
		const centeredY = nearestIntegerAnchor(
			source.minY + source.maxY + 1,
			this.bounds.minY + this.bounds.maxY + 1,
		);
		return Object.freeze([
			Object.freeze({
				x: source.maxX + gapMeters + 1 - this.bounds.minX,
				y: centeredY,
			}),
			Object.freeze({
				x: source.minX - gapMeters - 1 - this.bounds.maxX,
				y: centeredY,
			}),
			Object.freeze({
				x: centeredX,
				y: source.maxY + gapMeters + 1 - this.bounds.minY,
			}),
			Object.freeze({
				x: centeredX,
				y: source.minY - gapMeters - 1 - this.bounds.maxY,
			}),
		]);
	}

	/** Return the pointer cell whose centered placement resolves back to the supplied anchor. */
	pointerCellAtAnchor(anchor: Cell): Readonly<Cell> {
		const centerXTwice = anchor.x * 2 + this.bounds.minX + this.bounds.maxX + 1;
		const centerYTwice = anchor.y * 2 + this.bounds.minY + this.bounds.maxY + 1;
		return Object.freeze({
			x: Math.ceil(centerXTwice / 2) - 1,
			y: Math.ceil(centerYTwice / 2) - 1,
		});
	}

	private snapAnchorToSourceAxes(
		anchor: Readonly<Cell>,
	): StaticFabOrganizationBundlePlacementAlignment {
		const source = this.sourceBounds;
		if (!source) {
			return Object.freeze({
				anchor: Object.freeze({ x: anchor.x, y: anchor.y }),
				centerX: false,
				centerY: false,
			});
		}
		let x = anchor.x;
		let y = anchor.y;
		const targetCenterXTwice = x * 2 + this.bounds.minX + this.bounds.maxX + 1;
		const targetCenterYTwice = y * 2 + this.bounds.minY + this.bounds.maxY + 1;
		const deltaXTwice = source.minX + source.maxX + 1 - targetCenterXTwice;
		const deltaYTwice = source.minY + source.maxY + 1 - targetCenterYTwice;
		const centerX =
			deltaXTwice % 2 === 0 &&
			Math.abs(deltaXTwice / 2) <= ORGANIZATION_BUNDLE_ALIGNMENT_SNAP_METERS;
		const centerY =
			deltaYTwice % 2 === 0 &&
			Math.abs(deltaYTwice / 2) <= ORGANIZATION_BUNDLE_ALIGNMENT_SNAP_METERS;
		if (centerX) x += deltaXTwice / 2;
		if (centerY) y += deltaYTwice / 2;
		return Object.freeze({
			anchor: Object.freeze({ x, y }),
			centerX,
			centerY,
		});
	}
}

function prepareSourceBounds(
	input: StaticFabOrganizationBundleSourceBounds | null | undefined,
): StaticFabOrganizationBundleSourceBounds | null {
	if (input == null) return null;
	if (
		![input.minX, input.minY, input.maxX, input.maxY].every(Number.isSafeInteger) ||
		input.minX > input.maxX ||
		input.minY > input.maxY
	) {
		throw new TypeError("Organization bundle source bounds must be finite ordered integers");
	}
	return Object.freeze({
		minX: input.minX,
		minY: input.minY,
		maxX: input.maxX,
		maxY: input.maxY,
	});
}

function nearestIntegerAnchor(sourceCenterTwice: number, localCenterTwice: number): number {
	return Math.round((sourceCenterTwice - localCenterTwice) / 2);
}

function rotatedPlacementBounds(
	widthMeters: number,
	heightMeters: number,
	quarterTurns: StaticFabOrganizationBundleQuarterTurns,
): StaticFabOrganizationBundlePlacementBounds {
	const maxX = widthMeters;
	const maxY = heightMeters;
	if (quarterTurns === 0) return Object.freeze({ minX: 0, minY: 0, maxX, maxY });
	if (quarterTurns === 1) {
		return Object.freeze({ minX: -maxY, minY: 0, maxX: 0, maxY: maxX });
	}
	if (quarterTurns === 2) {
		return Object.freeze({ minX: -maxX, minY: -maxY, maxX: 0, maxY: 0 });
	}
	return Object.freeze({ minX: 0, minY: -maxX, maxX: maxY, maxY: 0 });
}

function isQuarterTurns(value: unknown): value is StaticFabOrganizationBundleQuarterTurns {
	return value === 0 || value === 1 || value === 2 || value === 3;
}

function rotationDegreesFor(
	quarterTurns: StaticFabOrganizationBundleQuarterTurns,
): StaticFabOrganizationBundleRotationDegrees {
	return [0, 90, 180, 270][quarterTurns] as StaticFabOrganizationBundleRotationDegrees;
}
