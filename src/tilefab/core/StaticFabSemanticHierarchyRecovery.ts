import { OrderedTypedChecksum } from "./OrderedTypedChecksum";
import {
	deriveStaticFabOrganizationSemanticRoles,
	resolveStaticFabOrganizationDescendantIds,
	type StaticFabOrganizationRecord,
	type StaticFabOrganizationSemanticRole,
	type StaticFabOrganizationState,
	staticFabOrganizationParentIds,
	staticFabOrganizationStateShapeError,
} from "./StaticFabOrganization";

export const STATIC_FAB_SEMANTIC_HIERARCHY_RECOVERY_VERSION = 1 as const;
export const STATIC_FAB_SEMANTIC_HIERARCHY_RECOVERY_MAX_ORGANIZATIONS = 100_000;
export const STATIC_FAB_SEMANTIC_HIERARCHY_RECOVERY_ID_SAMPLE_LIMIT = 128;

export type StaticFabSemanticHierarchyRecoveryAction = "DETACH" | "DELETE";
export type StaticFabSemanticHierarchyRecoveryTargetRole = "BAY_BANK" | "FAB";
export type StaticFabSemanticHierarchyRecoveryAttachmentState =
	| "ATTACHED_TO_ROOT_FAB"
	| "DETACHED"
	| "ROOT_FAB"
	| "UNRESOLVED";

export type StaticFabSemanticHierarchyRecoveryIssueCode =
	| "INVALID_INTENT"
	| "INVALID_SOURCE"
	| "SOURCE_LIMIT_EXCEEDED"
	| "MISSING_TARGET"
	| "ROLE_MISMATCH"
	| "UNSUPPORTED_OPERATION"
	| "ALREADY_DETACHED"
	| "STALE_PARENT_RELATIONSHIP"
	| "AMBIGUOUS_HIERARCHY"
	| "CROSS_OWNER_PARENT"
	| "SHARED_DESCENDANT_DEPENDENCY"
	| "SUBTREE_LIMIT_EXCEEDED";

export interface StaticFabSemanticHierarchyRecoveryIntent {
	readonly version: typeof STATIC_FAB_SEMANTIC_HIERARCHY_RECOVERY_VERSION;
	readonly action: StaticFabSemanticHierarchyRecoveryAction;
	readonly targetRole: StaticFabSemanticHierarchyRecoveryTargetRole;
	readonly targetOrganizationId: number;
	readonly expectedParentOrganizationId: number | null;
}

export interface StaticFabSemanticHierarchyRecoveryRoleCounts {
	readonly fab: number;
	readonly bayBank: number;
	readonly bay: number;
	readonly processLoop: number;
	readonly unrecognized: number;
}

/**
 * Organization-only source review. This is deliberately not a rail mutation plan or a certificate
 * for rail, Port, equipment, topology, ownership, history, or Worker readiness.
 */
export interface StaticFabSemanticHierarchyRecoveryReview {
	readonly version: typeof STATIC_FAB_SEMANTIC_HIERARCHY_RECOVERY_VERSION;
	readonly action: StaticFabSemanticHierarchyRecoveryAction | null;
	readonly targetRole: StaticFabSemanticHierarchyRecoveryTargetRole | null;
	readonly targetOrganizationId: number | null;
	readonly expectedParentOrganizationId: number | null;
	readonly targetName: string | null;
	readonly resolvedSemanticRole: StaticFabOrganizationSemanticRole | null;
	readonly attachmentState: StaticFabSemanticHierarchyRecoveryAttachmentState;
	readonly parentFabOrganizationId: number | null;
	readonly subtreeOrganizationIdSample: readonly number[];
	readonly subtreeOrganizationCount: number;
	readonly subtreeOrganizationOmittedCount: number;
	readonly subtreeOrganizationFingerprint: string | null;
	readonly roleCounts: StaticFabSemanticHierarchyRecoveryRoleCounts;
	readonly downstreamImpactStatus: "RAIL_PORT_EQUIPMENT_UNREVIEWED";
	readonly accepted: boolean;
	readonly issueCode: StaticFabSemanticHierarchyRecoveryIssueCode | null;
	readonly reason: string;
}

interface DiagnosticIntent {
	readonly action: StaticFabSemanticHierarchyRecoveryAction | null;
	readonly targetRole: StaticFabSemanticHierarchyRecoveryTargetRole | null;
	readonly targetOrganizationId: number | null;
	readonly expectedParentOrganizationId: number | null;
}

interface ResolvedScope {
	readonly target: StaticFabOrganizationRecord;
	readonly resolvedSemanticRole: StaticFabOrganizationSemanticRole;
	readonly subtreeOrganizationIds: readonly number[];
	readonly subtreeOrganizationFingerprint: string;
	readonly roleCounts: StaticFabSemanticHierarchyRecoveryRoleCounts;
	readonly attachmentState: StaticFabSemanticHierarchyRecoveryAttachmentState;
	readonly parentFabOrganizationId: number | null;
}

const INTENT_KEYS = Object.freeze([
	"version",
	"action",
	"expectedParentOrganizationId",
	"targetRole",
	"targetOrganizationId",
] as const);

const EMPTY_IDS = Object.freeze([]) as readonly number[];
const EMPTY_ROLE_COUNTS = Object.freeze({
	fab: 0,
	bayBank: 0,
	bay: 0,
	processLoop: 0,
	unrecognized: 0,
}) satisfies StaticFabSemanticHierarchyRecoveryRoleCounts;

export function staticFabSemanticHierarchyRecoveryIntentError(value: unknown): string | null {
	if (!isRecord(value)) return "Semantic hierarchy recovery intent must be an object.";
	if (!hasExactKeys(value, INTENT_KEYS)) {
		return "Semantic hierarchy recovery intent fields do not match version 1.";
	}
	if (value.version !== STATIC_FAB_SEMANTIC_HIERARCHY_RECOVERY_VERSION) {
		return "Semantic hierarchy recovery intent version is invalid.";
	}
	if (value.action !== "DETACH" && value.action !== "DELETE") {
		return "Semantic hierarchy recovery action is invalid.";
	}
	if (value.targetRole !== "BAY_BANK" && value.targetRole !== "FAB") {
		return "Semantic hierarchy recovery target role is invalid.";
	}
	if (!positiveInt32(value.targetOrganizationId)) {
		return "Semantic hierarchy recovery target organization id is invalid.";
	}
	if (
		value.expectedParentOrganizationId !== null &&
		!positiveInt32(value.expectedParentOrganizationId)
	) {
		return "Semantic hierarchy recovery expected parent organization id is invalid.";
	}
	return null;
}

/**
 * Resolve the exact current semantic organization scope for a future reviewed recovery command.
 * No returned acceptance grants permission to mutate rail, Ports, equipment, history, or a Worker.
 */
export function reviewStaticFabSemanticHierarchyRecovery(
	organizations: StaticFabOrganizationState,
	intentValue: unknown,
): StaticFabSemanticHierarchyRecoveryReview {
	const diagnosticIntent = readDiagnosticIntent(intentValue);
	const intentError = staticFabSemanticHierarchyRecoveryIntentError(intentValue);
	if (intentError) {
		return rejectedReview(diagnosticIntent, "INVALID_INTENT", intentError);
	}
	const intent = intentValue as StaticFabSemanticHierarchyRecoveryIntent;

	if (organizations.records.length > STATIC_FAB_SEMANTIC_HIERARCHY_RECOVERY_MAX_ORGANIZATIONS) {
		return rejectedReview(
			intent,
			"SOURCE_LIMIT_EXCEEDED",
			`Semantic hierarchy recovery는 최대 ${STATIC_FAB_SEMANTIC_HIERARCHY_RECOVERY_MAX_ORGANIZATIONS.toLocaleString()}개 조직 source를 검토합니다`,
		);
	}
	try {
		const sourceError = staticFabOrganizationStateShapeError(organizations);
		if (sourceError) {
			return rejectedReview(
				intent,
				"INVALID_SOURCE",
				`정적 FAB 조직 source가 유효하지 않습니다 · ${sourceError}`,
			);
		}
	} catch (error) {
		return rejectedReview(
			intent,
			"INVALID_SOURCE",
			`정적 FAB 조직 source를 읽을 수 없습니다 · ${errorMessage(error)}`,
		);
	}

	const recordsById = new Map(organizations.records.map((record) => [record.id, record]));
	const target = recordsById.get(intent.targetOrganizationId);
	if (!target) {
		return rejectedReview(
			intent,
			"MISSING_TARGET",
			`조직 ${intent.targetOrganizationId}을 찾을 수 없습니다`,
		);
	}

	const roles = deriveStaticFabOrganizationSemanticRoles(organizations);
	const resolvedSemanticRole = roles.get(target.id) ?? null;
	if (resolvedSemanticRole !== intent.targetRole) {
		return rejectedReview(
			intent,
			"ROLE_MISMATCH",
			`'${target.name}'은 현재 source에서 semantic ${intent.targetRole} 역할이 아닙니다`,
			resolvedSemanticRole ? { target, resolvedSemanticRole } : { target },
		);
	}

	const descendantIds = resolveStaticFabOrganizationDescendantIds(organizations, target.id);
	if (!descendantIds) {
		return rejectedReview(
			intent,
			"AMBIGUOUS_HIERARCHY",
			`'${target.name}'의 하위 조직을 해석할 수 없습니다`,
			{ target, resolvedSemanticRole },
		);
	}
	if (descendantIds.length + 1 > STATIC_FAB_SEMANTIC_HIERARCHY_RECOVERY_MAX_ORGANIZATIONS) {
		return rejectedReview(
			intent,
			"SUBTREE_LIMIT_EXCEEDED",
			`삭제 범위는 최대 ${STATIC_FAB_SEMANTIC_HIERARCHY_RECOVERY_MAX_ORGANIZATIONS.toLocaleString()}개 조직을 지원합니다`,
			{ target, resolvedSemanticRole },
		);
	}

	const subtreeOrganizationIds = Object.freeze(
		[target.id, ...descendantIds].sort((left, right) => left - right),
	);
	const subtreeIdSet = new Set(subtreeOrganizationIds);
	const roleCounts = countSemanticRoles(subtreeOrganizationIds, roles);
	const subtreeOrganizationFingerprint = fingerprintSemanticHierarchySubtree(
		subtreeOrganizationIds,
		recordsById,
		roles,
	);
	const parentResolution = resolveTargetParent(intent.targetRole, target, recordsById, roles);
	const baseScope = {
		target,
		resolvedSemanticRole,
		subtreeOrganizationIds,
		subtreeOrganizationFingerprint,
		roleCounts,
		attachmentState: parentResolution.attachmentState,
		parentFabOrganizationId: parentResolution.parentFabOrganizationId,
	} satisfies ResolvedScope;
	if (parentResolution.failure) {
		return rejectedReview(
			intent,
			parentResolution.failure.issueCode,
			parentResolution.failure.reason,
			baseScope,
		);
	}
	if (intent.expectedParentOrganizationId !== parentResolution.parentFabOrganizationId) {
		return rejectedReview(
			intent,
			"STALE_PARENT_RELATIONSHIP",
			`검토한 상위 관계가 현재 source와 다릅니다 · expected ${formatParentId(intent.expectedParentOrganizationId)} / current ${formatParentId(parentResolution.parentFabOrganizationId)}`,
			baseScope,
		);
	}

	for (const descendantId of descendantIds) {
		const descendant = recordsById.get(descendantId);
		if (!descendant) {
			return rejectedReview(
				intent,
				"AMBIGUOUS_HIERARCHY",
				`하위 조직 ${descendantId}을 찾을 수 없습니다`,
				baseScope,
			);
		}
		if (staticFabOrganizationParentIds(descendant).some((id) => !subtreeIdSet.has(id))) {
			return rejectedReview(
				intent,
				"SHARED_DESCENDANT_DEPENDENCY",
				`하위 조직 '${descendant.name}'이 선택 범위 밖의 부모와 공유됩니다`,
				baseScope,
			);
		}
	}

	const hierarchyError = exactSubtreeHierarchyError(
		intent.targetRole,
		target.id,
		descendantIds,
		recordsById,
		roles,
	);
	if (hierarchyError) {
		return rejectedReview(intent, "AMBIGUOUS_HIERARCHY", hierarchyError, baseScope);
	}

	if (intent.targetRole === "FAB" && intent.action === "DETACH") {
		return rejectedReview(
			intent,
			"UNSUPPORTED_OPERATION",
			"root Fab에는 분리할 상위 hierarchy 관계가 없습니다 · FAB DETACH는 지원하지 않습니다",
			baseScope,
		);
	}
	if (intent.targetRole === "BAY_BANK" && intent.action === "DETACH") {
		if (parentResolution.attachmentState === "DETACHED") {
			return rejectedReview(
				intent,
				"ALREADY_DETACHED",
				`'${target.name}'은 이미 Fab에서 분리되어 있습니다`,
				baseScope,
			);
		}
	}

	return acceptedReview(
		intent,
		baseScope,
		intent.action === "DETACH"
			? `Bay Bank '${target.name}'의 root Fab 관계를 분리할 조직 범위를 검토했습니다`
			: `${intent.targetRole === "FAB" ? "Fab" : "Bay Bank"} '${target.name}'의 삭제 조직 범위를 검토했습니다`,
	);
}

function resolveTargetParent(
	targetRole: StaticFabSemanticHierarchyRecoveryTargetRole,
	target: StaticFabOrganizationRecord,
	recordsById: ReadonlyMap<number, StaticFabOrganizationRecord>,
	roles: ReadonlyMap<number, StaticFabOrganizationSemanticRole>,
): {
	readonly attachmentState: StaticFabSemanticHierarchyRecoveryAttachmentState;
	readonly parentFabOrganizationId: number | null;
	readonly failure: {
		readonly issueCode: "AMBIGUOUS_HIERARCHY" | "CROSS_OWNER_PARENT";
		readonly reason: string;
	} | null;
} {
	const parentIds = staticFabOrganizationParentIds(target);
	if (targetRole === "FAB") {
		return parentIds.length === 0
			? Object.freeze({
					attachmentState: "ROOT_FAB" as const,
					parentFabOrganizationId: null,
					failure: null,
				})
			: Object.freeze({
					attachmentState: "UNRESOLVED" as const,
					parentFabOrganizationId: null,
					failure: Object.freeze({
						issueCode: "CROSS_OWNER_PARENT" as const,
						reason: "현재 v1은 parent 없는 root semantic Fab만 처리합니다",
					}),
				});
	}
	if (parentIds.length === 0) {
		return Object.freeze({
			attachmentState: "DETACHED" as const,
			parentFabOrganizationId: null,
			failure: null,
		});
	}
	if (parentIds.length !== 1) {
		return Object.freeze({
			attachmentState: "UNRESOLVED" as const,
			parentFabOrganizationId: null,
			failure: Object.freeze({
				issueCode: "AMBIGUOUS_HIERARCHY" as const,
				reason: "현재 v1은 정확히 하나의 root Fab 부모 또는 완전히 detached Bay Bank만 처리합니다",
			}),
		});
	}
	const parentId = parentIds[0] as number;
	const parent = recordsById.get(parentId);
	if (
		!parent ||
		roles.get(parent.id) !== "FAB" ||
		staticFabOrganizationParentIds(parent).length !== 0
	) {
		return Object.freeze({
			attachmentState: "UNRESOLVED" as const,
			parentFabOrganizationId: null,
			failure: Object.freeze({
				issueCode: "CROSS_OWNER_PARENT" as const,
				reason: "Bay Bank 부모는 parent 없는 exact semantic Fab이어야 합니다",
			}),
		});
	}
	return Object.freeze({
		attachmentState: "ATTACHED_TO_ROOT_FAB" as const,
		parentFabOrganizationId: parent.id,
		failure: null,
	});
}

function exactSubtreeHierarchyError(
	targetRole: StaticFabSemanticHierarchyRecoveryTargetRole,
	targetId: number,
	descendantIds: readonly number[],
	recordsById: ReadonlyMap<number, StaticFabOrganizationRecord>,
	roles: ReadonlyMap<number, StaticFabOrganizationSemanticRole>,
): string | null {
	for (const descendantId of descendantIds) {
		const descendant = recordsById.get(descendantId);
		if (!descendant) return `하위 조직 ${descendantId}을 찾을 수 없습니다`;
		const role = roles.get(descendant.id);
		const parentIds = staticFabOrganizationParentIds(descendant);
		if (role === "BAY_BANK" && targetRole === "FAB") {
			if (parentIds.length === 1 && parentIds[0] === targetId) continue;
			return `Bay Bank '${descendant.name}'은 선택 Fab의 direct 단일 자식이어야 합니다`;
		}
		if (role === "BAY") {
			if (parentIds.length === 1 && roles.get(parentIds[0] as number) === "BAY_BANK") {
				continue;
			}
			return `Bay '${descendant.name}'은 하나의 semantic Bay Bank에 직접 속해야 합니다`;
		}
		if (role === "PROCESS_LOOP") {
			if (parentIds.length === 1 && roles.get(parentIds[0] as number) === "BAY") continue;
			return `Process Loop '${descendant.name}'은 하나의 semantic Bay에 직접 속해야 합니다`;
		}
		return `'${descendant.name}'은 ${targetRole} 삭제 범위의 지원되는 semantic descendant가 아닙니다`;
	}
	return null;
}

function countSemanticRoles(
	organizationIds: readonly number[],
	roles: ReadonlyMap<number, StaticFabOrganizationSemanticRole>,
): StaticFabSemanticHierarchyRecoveryRoleCounts {
	let fab = 0;
	let bayBank = 0;
	let bay = 0;
	let processLoop = 0;
	let unrecognized = 0;
	for (const id of organizationIds) {
		switch (roles.get(id)) {
			case "FAB":
				fab++;
				break;
			case "BAY_BANK":
				bayBank++;
				break;
			case "BAY":
				bay++;
				break;
			case "PROCESS_LOOP":
				processLoop++;
				break;
			default:
				unrecognized++;
		}
	}
	return Object.freeze({ fab, bayBank, bay, processLoop, unrecognized });
}

function fingerprintSemanticHierarchySubtree(
	organizationIds: readonly number[],
	recordsById: ReadonlyMap<number, StaticFabOrganizationRecord>,
	roles: ReadonlyMap<number, StaticFabOrganizationSemanticRole>,
): string {
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings(["STATIC_FAB_SEMANTIC_HIERARCHY_RECOVERY_SUBTREE_V1"]);
	checksum.addNumbers([organizationIds.length]);
	for (const id of organizationIds) {
		const record = recordsById.get(id);
		if (!record) throw new Error(`Semantic hierarchy subtree organization ${id} is missing.`);
		const parentIds = staticFabOrganizationParentIds(record);
		checksum.addNumbers([id, semanticRoleCode(roles.get(id)), parentIds.length, ...parentIds]);
	}
	return checksum.digest();
}

function semanticRoleCode(role: StaticFabOrganizationSemanticRole | undefined): number {
	switch (role) {
		case "FAB":
			return 1;
		case "BAY_BANK":
			return 2;
		case "BAY":
			return 3;
		case "PROCESS_LOOP":
			return 4;
		default:
			return 0;
	}
}

function acceptedReview(
	intent: StaticFabSemanticHierarchyRecoveryIntent,
	scope: ResolvedScope,
	reason: string,
): StaticFabSemanticHierarchyRecoveryReview {
	return createReview(intent, scope, true, null, reason);
}

function rejectedReview(
	intent: DiagnosticIntent,
	issueCode: StaticFabSemanticHierarchyRecoveryIssueCode,
	reason: string,
	scope?: Partial<ResolvedScope>,
): StaticFabSemanticHierarchyRecoveryReview {
	return createReview(intent, scope, false, issueCode, reason);
}

function createReview(
	intent: DiagnosticIntent,
	scope: Partial<ResolvedScope> | undefined,
	accepted: boolean,
	issueCode: StaticFabSemanticHierarchyRecoveryIssueCode | null,
	reason: string,
): StaticFabSemanticHierarchyRecoveryReview {
	const subtreeOrganizationIds = scope?.subtreeOrganizationIds ?? EMPTY_IDS;
	const subtreeOrganizationIdSample = Object.freeze(
		subtreeOrganizationIds.slice(0, STATIC_FAB_SEMANTIC_HIERARCHY_RECOVERY_ID_SAMPLE_LIMIT),
	);
	return Object.freeze({
		version: STATIC_FAB_SEMANTIC_HIERARCHY_RECOVERY_VERSION,
		action: intent.action,
		targetRole: intent.targetRole,
		targetOrganizationId: intent.targetOrganizationId,
		expectedParentOrganizationId: intent.expectedParentOrganizationId,
		targetName: scope?.target?.name ?? null,
		resolvedSemanticRole: scope?.resolvedSemanticRole ?? null,
		attachmentState: scope?.attachmentState ?? "UNRESOLVED",
		parentFabOrganizationId: scope?.parentFabOrganizationId ?? null,
		subtreeOrganizationIdSample,
		subtreeOrganizationCount: subtreeOrganizationIds.length,
		subtreeOrganizationOmittedCount:
			subtreeOrganizationIds.length - subtreeOrganizationIdSample.length,
		subtreeOrganizationFingerprint: scope?.subtreeOrganizationFingerprint ?? null,
		roleCounts: scope?.roleCounts ?? EMPTY_ROLE_COUNTS,
		downstreamImpactStatus: "RAIL_PORT_EQUIPMENT_UNREVIEWED",
		accepted,
		issueCode,
		reason,
	});
}

function readDiagnosticIntent(value: unknown): DiagnosticIntent {
	const record = isRecord(value) ? value : {};
	return Object.freeze({
		action: record.action === "DETACH" || record.action === "DELETE" ? record.action : null,
		targetRole:
			record.targetRole === "BAY_BANK" || record.targetRole === "FAB" ? record.targetRole : null,
		targetOrganizationId: positiveInt32(record.targetOrganizationId)
			? record.targetOrganizationId
			: null,
		expectedParentOrganizationId:
			record.expectedParentOrganizationId === null ||
			positiveInt32(record.expectedParentOrganizationId)
				? record.expectedParentOrganizationId
				: null,
	});
}

function formatParentId(value: number | null): string {
	return value === null ? "none" : String(value);
}

function errorMessage(error: unknown): string {
	return error instanceof Error && error.message ? error.message : "unknown source error";
}

function positiveInt32(value: unknown): value is number {
	return Number.isInteger(value) && (value as number) > 0 && (value as number) <= 0x7fff_ffff;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
	const actual = Object.keys(value).sort();
	const expected = [...keys].sort();
	return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
