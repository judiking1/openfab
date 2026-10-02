/** Compact candidate facts only; neither a registration plan nor commit authority. */
export interface StaticFabProcessLoopTopologyEvidence {
	readonly authoredCells: number;
	readonly authoredEdges: number;
	readonly authoredComponents: number;
	readonly authoredStrongComponents: number;
	readonly authoredOpenEnds: number;
	readonly authoredUnsafeJunctions: number;
	readonly authoredClosed: boolean;
	readonly physicalValid: boolean;
	readonly physicalPaths: number;
	readonly physicalStrongComponents: number;
	readonly physicalOpenPaths: number;
	readonly physicalInvalidPaths: number;
	readonly physicalDiagnostics: number;
	readonly physicalTerminals: number;
	readonly physicalClearanceIssues: number;
	readonly physicalClosed: boolean;
}

export interface StaticFabProcessLoopTopologyResult {
	readonly valid: boolean;
	readonly authoringAuthority: "NONE";
	readonly evidence: StaticFabProcessLoopTopologyEvidence;
}

const COUNT_KEYS = [
	"authoredCells",
	"authoredEdges",
	"authoredComponents",
	"authoredStrongComponents",
	"authoredOpenEnds",
	"authoredUnsafeJunctions",
	"physicalPaths",
	"physicalStrongComponents",
	"physicalOpenPaths",
	"physicalInvalidPaths",
	"physicalDiagnostics",
	"physicalTerminals",
	"physicalClearanceIssues",
] as const;
const BOOLEAN_KEYS = ["authoredClosed", "physicalValid", "physicalClosed"] as const;

/** Own a finite response without traversing or accepting compiled graphs/organization records. */
export function readStaticFabProcessLoopTopologyResult(
	value: unknown,
	edgeCount: number,
	switchCount: number,
): StaticFabProcessLoopTopologyResult {
	if (
		!hasExactProcessLoopFields(value, ["valid", "authoringAuthority", "evidence"]) ||
		typeof value.valid !== "boolean" ||
		value.authoringAuthority !== "NONE" ||
		!hasExactProcessLoopFields(value.evidence, [...COUNT_KEYS, ...BOOLEAN_KEYS])
	)
		throw new Error(
			"Process Loop topology response must contain only bounded facts with no authoring authority.",
		);
	const evidence = value.evidence;
	const maximum = Math.max(1, edgeCount * 16 + switchCount * 16);
	for (const key of COUNT_KEYS)
		if (
			!Number.isSafeInteger(evidence[key]) ||
			(evidence[key] as number) < 0 ||
			(evidence[key] as number) > maximum
		)
			throw new Error("Process Loop topology response count is outside candidate bounds.");
	for (const key of BOOLEAN_KEYS)
		if (typeof evidence[key] !== "boolean")
			throw new Error("Process Loop topology response flag is invalid.");
	const owned = Object.freeze({ ...evidence }) as unknown as StaticFabProcessLoopTopologyEvidence;
	if (
		owned.authoredEdges !== edgeCount ||
		owned.authoredCells > edgeCount * 2 ||
		owned.authoredComponents > owned.authoredCells ||
		owned.authoredStrongComponents > owned.authoredCells ||
		owned.authoredOpenEnds > owned.authoredCells ||
		owned.authoredUnsafeJunctions > owned.authoredCells ||
		owned.physicalStrongComponents > owned.physicalPaths ||
		owned.physicalOpenPaths > owned.physicalPaths ||
		owned.physicalPaths + owned.physicalInvalidPaths > maximum
	)
		throw new Error("Process Loop topology response does not match candidate dimensions.");
	const authoredClosed =
		owned.authoredCells > 0 &&
		owned.authoredComponents === 1 &&
		owned.authoredStrongComponents === 1 &&
		owned.authoredOpenEnds === 0 &&
		owned.authoredUnsafeJunctions === 0;
	const physicalClosed =
		owned.physicalValid &&
		owned.physicalPaths > 0 &&
		owned.physicalStrongComponents === 1 &&
		owned.physicalOpenPaths === 0 &&
		owned.physicalInvalidPaths === 0 &&
		owned.physicalDiagnostics === 0 &&
		owned.physicalTerminals === 0 &&
		owned.physicalClearanceIssues === 0;
	if (
		owned.authoredClosed !== authoredClosed ||
		owned.physicalClosed !== physicalClosed ||
		value.valid !== (authoredClosed && physicalClosed)
	)
		throw new Error("Process Loop topology response contains inconsistent closure facts.");
	return Object.freeze({ valid: value.valid, authoringAuthority: "NONE", evidence: owned });
}

export function hasExactProcessLoopFields(
	value: unknown,
	keys: readonly string[],
): value is Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) return false;
	return (
		Object.keys(value).length === keys.length &&
		keys.every((key) => {
			const descriptor = Object.getOwnPropertyDescriptor(value, key);
			return descriptor !== undefined && Object.hasOwn(descriptor, "value");
		})
	);
}
