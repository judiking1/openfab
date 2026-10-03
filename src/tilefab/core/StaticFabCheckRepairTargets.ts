import {
	type StaticFabAssemblyConnectorHierarchyRole,
	type StaticFabAssemblyConnectorIssueCode,
	type StaticFabAssemblyConnectorPurpose,
	staticFabAssemblyConnectorHierarchyEligibilityFromLookup,
	staticFabAssemblyInterbayConnectorHierarchyEligibilityFromLookup,
} from "./StaticFabAssemblyConnector";
import {
	type StaticFabOrganizationState,
	staticFabOrganizationDeclaredSemanticRole,
	staticFabOrganizationParentIds,
} from "./StaticFabOrganization";
import {
	assertStaticFabOrganizationMetadataLookupCurrent,
	type StaticFabOrganizationMetadataLookup,
} from "./StaticFabOrganizationMetadataLookup";

export type StaticFabCheckLoopRepairTarget = Readonly<
	| { status: "choose"; reason: string }
	| { status: "blocked"; reason: string }
	| { status: "ready"; organizationId: number; name: string }
>;

export type StaticFabCheckConnectorRepairTarget = Readonly<
	| { status: "choose"; reason: string }
	| { status: "blocked"; issueCode: StaticFabAssemblyConnectorIssueCode; reason: string }
	| {
			status: "ready";
			organizationIds: readonly [number, number];
			hierarchyRole: StaticFabAssemblyConnectorHierarchyRole;
			purpose: StaticFabAssemblyConnectorPurpose;
			reason: string;
	  }
>;

/** Metadata eligibility only. The existing typed controller/Worker still validates real repair. */
export function resolveStaticFabCheckLoopRepairTarget(
	organizations: StaticFabOrganizationState,
	lookup: StaticFabOrganizationMetadataLookup,
	explicitOrganizationId: number | null,
): StaticFabCheckLoopRepairTarget {
	return currentRead(organizations, lookup, () => {
		if (explicitOrganizationId === null) {
			return Object.freeze({ status: "choose", reason: "수리할 독립 작업 루프를 직접 선택하세요" });
		}
		const record = lookup.record(explicitOrganizationId);
		if (
			!record ||
			record.kind !== "AISLE" ||
			staticFabOrganizationDeclaredSemanticRole(record) !== "PROCESS_LOOP" ||
			staticFabOrganizationParentIds(record).length !== 0
		) {
			return Object.freeze({
				status: "blocked",
				reason: "선택한 대상이 현재 프로젝트의 직접 등록한 독립 작업 루프가 아닙니다",
			});
		}
		return Object.freeze({ status: "ready", organizationId: record.id, name: record.name });
	});
}

/** No default pair, geometry inference, or DISCONNECTED repair promise. */
export function resolveStaticFabCheckConnectorRepairTarget(
	organizations: StaticFabOrganizationState,
	lookup: StaticFabOrganizationMetadataLookup,
	explicitOrganizationIds: readonly number[],
): StaticFabCheckConnectorRepairTarget {
	// The caller supplies the index-owned lookup; eligibility reads never claim a second lease.
	// Own only a bounded pair before any external lifetime callback can change the caller array.
	const ownedIds =
		explicitOrganizationIds.length === 2
			? (Object.freeze([explicitOrganizationIds[0], explicitOrganizationIds[1]]) as readonly [
					number,
					number,
				])
			: null;
	return currentRead(organizations, lookup, () => {
		if (ownedIds === null) {
			return Object.freeze({
				status: "choose",
				reason: "연결할 Production Bay 두 개 또는 Bay Bank 두 개를 직접 선택하세요",
			});
		}
		const [sourceId, targetId] = ownedIds;
		if (sourceId === targetId) {
			return Object.freeze({
				status: "blocked",
				issueCode: "SAME_ORGANIZATION",
				reason: "서로 다른 조직 두 개를 선택하세요",
			});
		}
		const source = lookup.record(sourceId);
		const target = lookup.record(targetId);
		if (!source || !target) {
			return Object.freeze({
				status: "blocked",
				issueCode: "MISSING_ORGANIZATION",
				reason: "선택한 조직이 없거나 ID가 중복되었습니다 · 현재 검사를 다시 여세요",
			});
		}
		const sourceRole = lookup.semanticRole(source.id);
		const targetRole = lookup.semanticRole(target.id);
		const hierarchyRole =
			sourceRole === "BAY" && targetRole === "BAY"
				? "BAY_TO_BANK"
				: sourceRole === "BAY_BANK" && targetRole === "BAY_BANK"
					? "BANK_TO_FAB"
					: null;
		if (hierarchyRole === null) {
			return Object.freeze({
				status: "blocked",
				issueCode: "UNSUPPORTED_ORGANIZATION",
				reason:
					"같은 계층의 Production Bay 두 개 또는 Bay Bank 두 개를 선택하세요 · 작업 루프와 일반 조직은 연결 대상이 아닙니다",
			});
		}
		const eligibility =
			hierarchyRole === "BANK_TO_FAB"
				? staticFabAssemblyInterbayConnectorHierarchyEligibilityFromLookup(
						organizations,
						lookup,
						sourceId,
						targetId,
					)
				: staticFabAssemblyConnectorHierarchyEligibilityFromLookup(
						organizations,
						lookup,
						sourceId,
						targetId,
					);
		if (!eligibility.valid) {
			return Object.freeze({
				status: "blocked",
				issueCode: eligibility.issueCode,
				reason: eligibility.reason,
			});
		}
		return Object.freeze({
			status: "ready",
			organizationIds: Object.freeze([
				Math.min(sourceId, targetId),
				Math.max(sourceId, targetId),
			]) as readonly [number, number],
			hierarchyRole,
			purpose: eligibility.purpose,
			reason: eligibility.reason,
		});
	});
}

function currentRead<T>(
	organizations: StaticFabOrganizationState,
	lookup: StaticFabOrganizationMetadataLookup,
	read: () => T,
): T {
	assertStaticFabOrganizationMetadataLookupCurrent(lookup, organizations);
	const value = read();
	assertStaticFabOrganizationMetadataLookupCurrent(lookup, organizations);
	return value;
}
