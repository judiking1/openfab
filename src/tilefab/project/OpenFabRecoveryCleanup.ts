import type {
	OpenFabRecoveryCleanupPlan,
	OpenFabRecoveryCleanupRequest,
	OpenFabRecoveryProjectSummary,
} from "./OpenFabProjectPorts";

export const OPENFAB_RECOVERY_CLEANUP_DEFAULT_RETAINED_PROJECTS = 50;

export function planOpenFabRecoveryCleanup(
	summaries: readonly OpenFabRecoveryProjectSummary[],
	request: OpenFabRecoveryCleanupRequest,
): OpenFabRecoveryCleanupPlan {
	assertRetainedProjectCount(request.retainedProjectCount);
	const protectedProjectIds = normalizeProtectedProjectIds(request.protectedProjectIds ?? []);
	const protectedIds = new Set(protectedProjectIds);
	const ordered = [...summaries].sort(compareRecoverySummaries);
	let totalJsonCharacters = 0;
	for (const summary of ordered) {
		assertRecoverySummarySize(summary);
		totalJsonCharacters = addSafeCharacters(totalJsonCharacters, summary.jsonCharacters);
	}
	const candidates = Object.freeze(
		ordered
			.slice(request.retainedProjectCount)
			.filter((summary) => !protectedIds.has(summary.projectId))
			.map(copyRecoverySummary),
	);
	const removableJsonCharacters = candidates.reduce(
		(total, summary) => addSafeCharacters(total, summary.jsonCharacters),
		0,
	);
	return Object.freeze({
		retainedProjectCount: request.retainedProjectCount,
		protectedProjectIds,
		totalCount: ordered.length,
		retainedCount: ordered.length - candidates.length,
		removableCount: candidates.length,
		totalJsonCharacters,
		removableJsonCharacters,
		candidates,
	});
}

export function recoveryCleanupPlansEqual(
	left: OpenFabRecoveryCleanupPlan,
	right: OpenFabRecoveryCleanupPlan,
): boolean {
	if (
		left.retainedProjectCount !== right.retainedProjectCount ||
		left.totalCount !== right.totalCount ||
		left.retainedCount !== right.retainedCount ||
		left.removableCount !== right.removableCount ||
		left.totalJsonCharacters !== right.totalJsonCharacters ||
		left.removableJsonCharacters !== right.removableJsonCharacters ||
		left.protectedProjectIds.length !== right.protectedProjectIds.length ||
		left.candidates.length !== right.candidates.length
	) {
		return false;
	}
	return (
		left.protectedProjectIds.every(
			(projectId, index) => projectId === right.protectedProjectIds[index],
		) &&
		left.candidates.every((summary, index) =>
			recoveryProjectSummariesEqual(summary, right.candidates[index]),
		)
	);
}

export function recoveryProjectSummariesEqual(
	left: OpenFabRecoveryProjectSummary,
	right: OpenFabRecoveryProjectSummary | undefined,
): boolean {
	return (
		right !== undefined &&
		left.projectId === right.projectId &&
		left.name === right.name &&
		left.updatedAt === right.updatedAt &&
		left.authoredChecksum === right.authoredChecksum &&
		left.jsonCharacters === right.jsonCharacters
	);
}

function compareRecoverySummaries(
	left: OpenFabRecoveryProjectSummary,
	right: OpenFabRecoveryProjectSummary,
): number {
	return (
		right.updatedAt.localeCompare(left.updatedAt) || left.projectId.localeCompare(right.projectId)
	);
}

function normalizeProtectedProjectIds(projectIds: readonly string[]): readonly string[] {
	const normalized = new Set<string>();
	for (const projectId of projectIds) {
		if (typeof projectId !== "string" || projectId.length === 0) {
			throw new TypeError("Protected recovery project ids must be non-empty strings.");
		}
		normalized.add(projectId);
	}
	return Object.freeze([...normalized].sort());
}

function assertRetainedProjectCount(value: number): void {
	if (!Number.isSafeInteger(value) || value < 1) {
		throw new TypeError("Recovery cleanup must retain at least one project.");
	}
}

function assertRecoverySummarySize(summary: OpenFabRecoveryProjectSummary): void {
	if (!Number.isSafeInteger(summary.jsonCharacters) || summary.jsonCharacters < 0) {
		throw new TypeError("Recovery summary JSON characters must be a non-negative safe integer.");
	}
}

function addSafeCharacters(left: number, right: number): number {
	const sum = left + right;
	if (!Number.isSafeInteger(sum)) {
		throw new RangeError("Recovery JSON character total exceeds the safe integer range.");
	}
	return sum;
}

function copyRecoverySummary(
	summary: OpenFabRecoveryProjectSummary,
): OpenFabRecoveryProjectSummary {
	return Object.freeze({ ...summary });
}
