export const STATIC_FAB_ARRANGEMENT_VERSION = 1 as const;
export const STATIC_FAB_ARRANGEMENT_MAX_ROOTS = 1_024;

export type StaticFabArrangementAxis = "X" | "Z";

export type StaticFabArrangementMode =
	| "ALIGN_MIN"
	| "ALIGN_CENTER"
	| "ALIGN_MAX"
	| "DISTRIBUTE_CENTERS"
	| "DISTRIBUTE_GAPS";

export interface StaticFabArrangementBounds {
	readonly minX: number;
	readonly minZ: number;
	readonly maxXExclusive: number;
	readonly maxZExclusive: number;
}

/** One immutable authored root. Bounds are half-open integer meters. */
export interface StaticFabArrangementRoot {
	readonly key: string;
	readonly bounds: StaticFabArrangementBounds;
}

export interface StaticFabArrangementIntent {
	readonly version: typeof STATIC_FAB_ARRANGEMENT_VERSION;
	readonly axis: StaticFabArrangementAxis;
	readonly mode: StaticFabArrangementMode;
	readonly roots: readonly StaticFabArrangementRoot[];
}

export interface StaticFabArrangementTranslation {
	readonly key: string;
	readonly deltaX: number;
	readonly deltaZ: number;
	readonly before: StaticFabArrangementBounds;
	readonly after: StaticFabArrangementBounds;
}

export type StaticFabArrangementFailureCode =
	| "INVALID_INTENT"
	| "TOO_FEW_ROOTS"
	| "ROOT_LIMIT_EXCEEDED"
	| "DUPLICATE_ROOT"
	| "INSUFFICIENT_SPAN"
	| "COORDINATE_OVERFLOW"
	| "NO_CHANGE";

export type StaticFabArrangementResult =
	| {
			readonly valid: true;
			readonly code: null;
			readonly reason: string;
			readonly axis: StaticFabArrangementAxis;
			readonly mode: StaticFabArrangementMode;
			readonly translations: readonly StaticFabArrangementTranslation[];
			/** Maximum deviation from ideal center/gap spacing after 1 m snapping. */
			readonly maximumSnapErrorMeters: number;
	  }
	| {
			readonly valid: false;
			readonly code: StaticFabArrangementFailureCode;
			readonly reason: string;
			readonly axis: StaticFabArrangementAxis | null;
			readonly mode: StaticFabArrangementMode | null;
			readonly translations: readonly [];
			readonly maximumSnapErrorMeters: 0;
	  };

const INT32_MIN = -0x80000000;
const INT32_MAX = 0x7fffffff;
const MAXIMUM_ROOT_KEY_LENGTH = 256;

/**
 * Solve one deterministic grid arrangement without reading or mutating project state.
 *
 * Distribution keeps the first and last geometric roots fixed. Fractional ideal translations are
 * rounded to the nearest meter with ties going to the even integer, symmetrically for negatives.
 */
export function solveStaticFabArrangement(intent: unknown): StaticFabArrangementResult {
	if (!isRecord(intent)) return failure("INVALID_INTENT", "정렬 요청 형식이 유효하지 않습니다");
	const axis = intent.axis;
	const mode = intent.mode;
	if (!isAxis(axis) || !isMode(mode) || intent.version !== STATIC_FAB_ARRANGEMENT_VERSION) {
		return failure("INVALID_INTENT", "정렬 축, 방식 또는 버전이 유효하지 않습니다");
	}
	if (!Array.isArray(intent.roots)) {
		return failure("INVALID_INTENT", "정렬할 루트 목록이 유효하지 않습니다", axis, mode);
	}
	if (intent.roots.length > STATIC_FAB_ARRANGEMENT_MAX_ROOTS) {
		return failure(
			"ROOT_LIMIT_EXCEEDED",
			`한 번에 최대 ${STATIC_FAB_ARRANGEMENT_MAX_ROOTS.toLocaleString()}개 루트를 정렬할 수 있습니다`,
			axis,
			mode,
		);
	}
	const minimumRoots = mode === "DISTRIBUTE_CENTERS" || mode === "DISTRIBUTE_GAPS" ? 3 : 2;
	if (intent.roots.length < minimumRoots) {
		return failure(
			"TOO_FEW_ROOTS",
			mode === "DISTRIBUTE_CENTERS" || mode === "DISTRIBUTE_GAPS"
				? "분배하려면 서로 다른 루트가 3개 이상 필요합니다"
				: "정렬하려면 서로 다른 루트가 2개 이상 필요합니다",
			axis,
			mode,
		);
	}

	const roots: StaticFabArrangementRoot[] = [];
	const keys = new Set<string>();
	for (const value of intent.roots) {
		if (!isArrangementRoot(value)) {
			return failure(
				"INVALID_INTENT",
				"정렬 루트의 key 또는 bounds가 유효하지 않습니다",
				axis,
				mode,
			);
		}
		if (keys.has(value.key)) {
			return failure("DUPLICATE_ROOT", `정렬 루트 '${value.key}'가 중복되었습니다`, axis, mode);
		}
		keys.add(value.key);
		roots.push(freezeRoot(value));
	}

	const deltas =
		mode === "ALIGN_MIN" || mode === "ALIGN_CENTER" || mode === "ALIGN_MAX"
			? alignmentDeltas(roots, axis, mode)
			: distributionDeltas(roots, axis, mode);
	if (!deltas.valid) return failure(deltas.code, deltas.reason, axis, mode);

	const translations: StaticFabArrangementTranslation[] = [];
	let changed = false;
	for (const root of roots) {
		const delta = deltas.byKey.get(root.key);
		if (delta === undefined) {
			return failure("INVALID_INTENT", `정렬 루트 '${root.key}'의 이동량이 없습니다`, axis, mode);
		}
		const deltaX = axis === "X" ? delta : 0;
		const deltaZ = axis === "Z" ? delta : 0;
		const after = translateBounds(root.bounds, deltaX, deltaZ);
		if (!after) {
			return failure(
				"COORDINATE_OVERFLOW",
				`정렬 후 루트 '${root.key}'가 signed int32 좌표 범위를 벗어납니다`,
				axis,
				mode,
			);
		}
		changed ||= delta !== 0;
		translations.push(Object.freeze({ key: root.key, deltaX, deltaZ, before: root.bounds, after }));
	}
	if (!changed) {
		return failure("NO_CHANGE", "선택한 루트가 이미 요청한 배치에 맞춰져 있습니다", axis, mode);
	}

	return Object.freeze({
		valid: true,
		code: null,
		reason: arrangementReason(axis, mode, translations.length, deltas.maximumSnapErrorMeters),
		axis,
		mode,
		translations: Object.freeze(translations),
		maximumSnapErrorMeters: deltas.maximumSnapErrorMeters,
	});
}

interface DeltaResult {
	readonly valid: true;
	readonly byKey: ReadonlyMap<string, number>;
	readonly maximumSnapErrorMeters: number;
}

interface DeltaFailure {
	readonly valid: false;
	readonly code: StaticFabArrangementFailureCode;
	readonly reason: string;
}

function alignmentDeltas(
	roots: readonly StaticFabArrangementRoot[],
	axis: StaticFabArrangementAxis,
	mode: "ALIGN_MIN" | "ALIGN_CENTER" | "ALIGN_MAX",
): DeltaResult {
	const minimum = Math.min(...roots.map((root) => axisMinimum(root.bounds, axis)));
	const maximum = Math.max(...roots.map((root) => axisMaximum(root.bounds, axis)));
	const targetCenterTwice = minimum + maximum;
	const byKey = new Map<string, number>();
	let maximumSnapErrorMeters = 0;
	for (const root of roots) {
		const delta =
			mode === "ALIGN_MIN"
				? minimum - axisMinimum(root.bounds, axis)
				: mode === "ALIGN_MAX"
					? maximum - axisMaximum(root.bounds, axis)
					: roundRationalTiesToEven(
							BigInt(targetCenterTwice - axisCenterTwice(root.bounds, axis)),
							2n,
						);
		byKey.set(root.key, delta);
		if (mode === "ALIGN_CENTER") {
			const resultingCenterTwice = axisCenterTwice(root.bounds, axis) + delta * 2;
			maximumSnapErrorMeters = Math.max(
				maximumSnapErrorMeters,
				Math.abs(targetCenterTwice - resultingCenterTwice) / 2,
			);
		}
	}
	return Object.freeze({ valid: true, byKey, maximumSnapErrorMeters });
}

function distributionDeltas(
	roots: readonly StaticFabArrangementRoot[],
	axis: StaticFabArrangementAxis,
	mode: "DISTRIBUTE_CENTERS" | "DISTRIBUTE_GAPS",
): DeltaResult | DeltaFailure {
	const ordered = [...roots].sort((left, right) => compareRootsOnAxis(left, right, axis));
	const lastIndex = ordered.length - 1;
	const denominator = BigInt(lastIndex);
	const byKey = new Map<string, number>();
	let maximumSnapErrorMeters = 0;
	const firstRoot = ordered[0];
	const lastRoot = ordered[lastIndex];
	if (!firstRoot || !lastRoot) {
		return Object.freeze({
			valid: false,
			code: "TOO_FEW_ROOTS",
			reason: "분배하려면 서로 다른 루트가 3개 이상 필요합니다",
		});
	}

	if (mode === "DISTRIBUTE_CENTERS") {
		const firstCenterTwice = axisCenterTwice(firstRoot.bounds, axis);
		const lastCenterTwice = axisCenterTwice(lastRoot.bounds, axis);
		for (let index = 0; index <= lastIndex; index++) {
			const root = ordered[index];
			if (!root) {
				return Object.freeze({
					valid: false,
					code: "INVALID_INTENT",
					reason: "분배 루트 순서가 유효하지 않습니다",
				});
			}
			const currentCenterTwice = axisCenterTwice(root.bounds, axis);
			const idealNumerator = BigInt(
				firstCenterTwice * (lastIndex - index) + lastCenterTwice * index,
			);
			const deltaNumerator = idealNumerator - BigInt(currentCenterTwice * lastIndex);
			const delta = roundRationalTiesToEven(deltaNumerator, denominator * 2n);
			byKey.set(root.key, delta);
			const resultingCenterTwice = currentCenterTwice + delta * 2;
			const residualNumerator = BigInt(resultingCenterTwice * lastIndex) - idealNumerator;
			maximumSnapErrorMeters = Math.max(
				maximumSnapErrorMeters,
				Number(absBigInt(residualNumerator)) / (lastIndex * 2),
			);
		}
		return Object.freeze({ valid: true, byKey, maximumSnapErrorMeters });
	}

	const firstMinimum = axisMinimum(firstRoot.bounds, axis);
	const lastMaximum = axisMaximum(lastRoot.bounds, axis);
	const widths = ordered.map(
		(root) => axisMaximum(root.bounds, axis) - axisMinimum(root.bounds, axis),
	);
	const free = lastMaximum - firstMinimum - widths.reduce((sum, width) => sum + width, 0);
	if (free < 0) {
		return Object.freeze({
			valid: false,
			code: "INSUFFICIENT_SPAN",
			reason: "선택한 루트의 전체 폭보다 분배 구간이 좁아 같은 간격으로 배치할 수 없습니다",
		});
	}
	let prefixWidth = 0;
	for (let index = 0; index <= lastIndex; index++) {
		const root = ordered[index];
		const width = widths[index];
		if (!root || width === undefined) {
			return Object.freeze({
				valid: false,
				code: "INVALID_INTENT",
				reason: "분배 루트 폭이 유효하지 않습니다",
			});
		}
		const snappedFree = roundRationalTiesToEven(BigInt(index * free), denominator);
		const targetMinimum = firstMinimum + prefixWidth + snappedFree;
		const delta = targetMinimum - axisMinimum(root.bounds, axis);
		byKey.set(root.key, delta);
		const residualNumerator = BigInt(snappedFree * lastIndex - index * free);
		maximumSnapErrorMeters = Math.max(
			maximumSnapErrorMeters,
			Number(absBigInt(residualNumerator)) / lastIndex,
		);
		prefixWidth += width;
	}
	return Object.freeze({ valid: true, byKey, maximumSnapErrorMeters });
}

function roundRationalTiesToEven(numerator: bigint, denominator: bigint): number {
	if (denominator <= 0n) throw new RangeError("Arrangement rounding denominator must be positive.");
	const quotient = numerator / denominator;
	const remainder = numerator % denominator;
	const doubledRemainder = absBigInt(remainder) * 2n;
	let rounded = quotient;
	if (
		doubledRemainder > denominator ||
		(doubledRemainder === denominator && absBigInt(quotient) % 2n === 1n)
	) {
		rounded += numerator < 0n ? -1n : 1n;
	}
	const value = Number(rounded);
	if (!Number.isSafeInteger(value)) {
		throw new RangeError("Arrangement translation exceeds the safe integer range.");
	}
	return value;
}

function compareRootsOnAxis(
	left: StaticFabArrangementRoot,
	right: StaticFabArrangementRoot,
	axis: StaticFabArrangementAxis,
): number {
	return (
		axisCenterTwice(left.bounds, axis) - axisCenterTwice(right.bounds, axis) ||
		axisMinimum(left.bounds, axis) - axisMinimum(right.bounds, axis) ||
		axisMaximum(left.bounds, axis) - axisMaximum(right.bounds, axis) ||
		(left.key < right.key ? -1 : left.key > right.key ? 1 : 0)
	);
}

function arrangementReason(
	axis: StaticFabArrangementAxis,
	mode: StaticFabArrangementMode,
	rootCount: number,
	maximumSnapErrorMeters: number,
): string {
	const label =
		mode === "ALIGN_MIN"
			? "최소 경계 정렬"
			: mode === "ALIGN_CENTER"
				? "중앙 정렬"
				: mode === "ALIGN_MAX"
					? "최대 경계 정렬"
					: mode === "DISTRIBUTE_CENTERS"
						? "중심 균등 분배"
						: "간격 균등 분배";
	const snap =
		maximumSnapErrorMeters > 0 ? ` · 1 m 스냅 오차 최대 ${maximumSnapErrorMeters} m` : "";
	return `${rootCount}개 루트 ${axis}축 ${label}${snap}`;
}

function axisMinimum(bounds: StaticFabArrangementBounds, axis: StaticFabArrangementAxis): number {
	return axis === "X" ? bounds.minX : bounds.minZ;
}

function axisMaximum(bounds: StaticFabArrangementBounds, axis: StaticFabArrangementAxis): number {
	return axis === "X" ? bounds.maxXExclusive : bounds.maxZExclusive;
}

function axisCenterTwice(
	bounds: StaticFabArrangementBounds,
	axis: StaticFabArrangementAxis,
): number {
	return axisMinimum(bounds, axis) + axisMaximum(bounds, axis);
}

function translateBounds(
	bounds: StaticFabArrangementBounds,
	deltaX: number,
	deltaZ: number,
): StaticFabArrangementBounds | null {
	const translated = {
		minX: bounds.minX + deltaX,
		minZ: bounds.minZ + deltaZ,
		maxXExclusive: bounds.maxXExclusive + deltaX,
		maxZExclusive: bounds.maxZExclusive + deltaZ,
	};
	return validBounds(translated) ? freezeBounds(translated) : null;
}

function isArrangementRoot(value: unknown): value is StaticFabArrangementRoot {
	return (
		isRecord(value) &&
		typeof value.key === "string" &&
		value.key.length > 0 &&
		value.key.length <= MAXIMUM_ROOT_KEY_LENGTH &&
		!hasControlCharacter(value.key) &&
		validBounds(value.bounds)
	);
}

function validBounds(value: unknown): value is StaticFabArrangementBounds {
	if (!isRecord(value)) return false;
	const { minX, minZ, maxXExclusive, maxZExclusive } = value;
	return (
		isInt32(minX) &&
		isInt32(minZ) &&
		isInt32(maxXExclusive) &&
		isInt32(maxZExclusive) &&
		minX < maxXExclusive &&
		minZ < maxZExclusive
	);
}

function freezeRoot(root: StaticFabArrangementRoot): StaticFabArrangementRoot {
	return Object.freeze({ key: root.key, bounds: freezeBounds(root.bounds) });
}

function freezeBounds(bounds: StaticFabArrangementBounds): StaticFabArrangementBounds {
	return Object.freeze({
		minX: bounds.minX,
		minZ: bounds.minZ,
		maxXExclusive: bounds.maxXExclusive,
		maxZExclusive: bounds.maxZExclusive,
	});
}

function failure(
	code: StaticFabArrangementFailureCode,
	reason: string,
	axis: StaticFabArrangementAxis | null = null,
	mode: StaticFabArrangementMode | null = null,
): StaticFabArrangementResult {
	return Object.freeze({
		valid: false,
		code,
		reason,
		axis,
		mode,
		translations: Object.freeze([]) as readonly [],
		maximumSnapErrorMeters: 0,
	});
}

function isAxis(value: unknown): value is StaticFabArrangementAxis {
	return value === "X" || value === "Z";
}

function isMode(value: unknown): value is StaticFabArrangementMode {
	return (
		value === "ALIGN_MIN" ||
		value === "ALIGN_CENTER" ||
		value === "ALIGN_MAX" ||
		value === "DISTRIBUTE_CENTERS" ||
		value === "DISTRIBUTE_GAPS"
	);
}

function isInt32(value: unknown): value is number {
	return (
		Number.isInteger(value) && (value as number) >= INT32_MIN && (value as number) <= INT32_MAX
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasControlCharacter(value: string): boolean {
	for (const character of value) {
		const code = character.charCodeAt(0);
		if (code < 0x20 || code === 0x7f) return true;
	}
	return false;
}

function absBigInt(value: bigint): bigint {
	return value < 0n ? -value : value;
}
