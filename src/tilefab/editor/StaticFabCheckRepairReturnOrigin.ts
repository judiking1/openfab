import type {
	StaticFabCheckRepairContinuation,
	StaticFabCheckRepairSource,
} from "./StaticFabCheckRepairContinuation";

/** Project-lifetime navigation only. A launched repair's own authored edits may change Checks. */
export interface StaticFabCheckRepairReturnOrigin {
	readonly document: StaticFabCheckRepairSource["document"];
	readonly projectId: string;
	readonly projectGeneration: number;
	readonly issueId: string;
	readonly issueCode: string;
	readonly locationIndex: number;
	readonly sourceKey: string;
	readonly readinessFingerprint: string;
}

export function staticFabCheckRepairReturnOrigin(
	continuation: StaticFabCheckRepairContinuation,
): StaticFabCheckRepairReturnOrigin {
	const { document, projectId, projectGeneration, sourceKey, readinessFingerprint } =
		continuation.source;
	return Object.freeze({
		document,
		projectId,
		projectGeneration,
		sourceKey,
		readinessFingerprint,
		issueId: continuation.issueId,
		issueCode: continuation.issueCode,
		locationIndex: continuation.locationIndex,
	});
}

export function staticFabCheckRepairReturnMatchesProject(
	origin: StaticFabCheckRepairReturnOrigin,
	current: Pick<StaticFabCheckRepairSource, "document" | "projectId" | "projectGeneration">,
): boolean {
	return (
		origin.document === current.document &&
		origin.projectId === current.projectId &&
		origin.projectGeneration === current.projectGeneration
	);
}
