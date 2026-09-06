export const STATIC_FAB_ORGANIZATION_BUNDLE_MAX_RELATIONSHIPS = 1_024;
export const STATIC_FAB_ORGANIZATION_BUNDLE_MAX_RELATIONSHIP_GROUPS = 65_536;
export const STATIC_FAB_ORGANIZATION_BUNDLE_MAX_RELATIONSHIP_LEGS = 131_072;
export const STATIC_FAB_ORGANIZATION_BUNDLE_MAX_RELATIONSHIP_EDGE_REFERENCES = 65_536;
export const STATIC_FAB_ORGANIZATION_BUNDLE_MAX_RELATIONSHIP_OWNER_IDS = 262_144;

/**
 * Count the portable payload before allocating shape/source indices or copies. Aliases count as
 * references too; each endpoint support also refers to its adjacent cut edge. This is a resource
 * preflight, not a replacement for the exact relationship shape and source validators.
 * A null local count is used only for a validated source cut before remapping its runtime IDs.
 */
export function* assertStaticFabOrganizationBundleRelationshipBudgetSteps(
	input: unknown,
	localOrganizationCount: number | null,
	firstOrganizationId = 1,
	firstRelationshipId = 1,
): Generator<void, void> {
	if (
		localOrganizationCount !== null &&
		(!Number.isInteger(localOrganizationCount) ||
			localOrganizationCount < 0 ||
			!Number.isInteger(firstOrganizationId) ||
			firstOrganizationId < 1 ||
			firstOrganizationId + localOrganizationCount > 0x7fff_ffff ||
			!Number.isInteger(firstRelationshipId) ||
			firstRelationshipId < 1)
	)
		throw new Error("청사진 관계 ID 범위가 유효하지 않습니다");
	const state = record(input);
	const relationships = array(state.records);
	limit(relationships.length, STATIC_FAB_ORGANIZATION_BUNDLE_MAX_RELATIONSHIPS, "관계");
	if (
		localOrganizationCount !== null &&
		(state.nextRelationshipId !== relationships.length + firstRelationshipId ||
			relationships.length + firstRelationshipId > 0x7fff_ffff)
	) {
		throw new Error("청사진의 다음 관계 ID가 할당 범위와 일치하지 않습니다");
	}
	let groups = 0;
	let legs = 0;
	let references = 0;
	let owners = 0;
	const organizationId = (id: unknown): void => {
		if (
			localOrganizationCount !== null &&
			(!Number.isInteger(id) ||
				(id as number) < firstOrganizationId ||
				(id as number) >= firstOrganizationId + localOrganizationCount)
		) {
			throw new Error("청사진 관계가 포함되지 않은 조직을 참조합니다");
		}
	};
	function* scopedEdge(value: unknown): Generator<void, void> {
		const scope = record(record(value).scope);
		if (scope.kind === "PARENT_DIRECT") return;
		const ids = array(scope.directOwnerOrganizationIds);
		owners += ids.length;
		limit(owners, STATIC_FAB_ORGANIZATION_BUNDLE_MAX_RELATIONSHIP_OWNER_IDS, "소유자 참조");
		for (const id of ids) {
			organizationId(id);
			yield;
		}
	}
	for (let index = 0; index < relationships.length; index++) {
		yield;
		const relationship = record(relationships[index]);
		if (localOrganizationCount !== null && relationship.id !== index + firstRelationshipId) {
			throw new Error("청사진 관계 ID는 할당 범위에서 연속이어야 합니다");
		}
		organizationId(relationship.parentOrganizationId);
		for (const key of ["participantOrganizationIds", "managedChildOrganizationIds"] as const) {
			const ids = array(relationship[key]);
			limit(ids.length, 2, "참여 조직");
			for (const id of ids) organizationId(id);
		}
		const connectionGroups = array(relationship.connectionGroups);
		groups += connectionGroups.length;
		limit(groups, STATIC_FAB_ORGANIZATION_BUNDLE_MAX_RELATIONSHIP_GROUPS, "연결 그룹");
		for (const value of connectionGroups) {
			yield;
			const groupLegs = array(record(value).legs);
			legs += groupLegs.length;
			limit(legs, STATIC_FAB_ORGANIZATION_BUNDLE_MAX_RELATIONSHIP_LEGS, "연결 경로");
			for (const value of groupLegs) {
				yield;
				const leg = record(value);
				const cuts = array(leg.exclusiveCutEdges);
				const supports = array(leg.endpointSupports);
				const seams = array(leg.seamContacts);
				references += cuts.length + 2 * supports.length;
				limit(
					references,
					STATIC_FAB_ORGANIZATION_BUNDLE_MAX_RELATIONSHIP_EDGE_REFERENCES,
					"레일 참조",
				);
				// Every valid seam has incidences, so reject a giant empty-seam array before iterating it.
				limit(
					seams.length,
					STATIC_FAB_ORGANIZATION_BUNDLE_MAX_RELATIONSHIP_EDGE_REFERENCES,
					"접점",
				);
				for (const edge of cuts) {
					yield;
					yield* scopedEdge(edge);
				}
				for (const support of supports) {
					yield;
					yield* scopedEdge(record(support).support);
				}
				for (const seam of seams) {
					yield;
					const incidences = array(record(seam).incidences);
					if (incidences.length === 0) throw new Error("청사진 접점의 연결 참조가 누락되었습니다");
					references += incidences.length;
					limit(
						references,
						STATIC_FAB_ORGANIZATION_BUNDLE_MAX_RELATIONSHIP_EDGE_REFERENCES,
						"레일 참조",
					);
					for (const incidence of incidences) {
						yield;
						const binding = record(record(incidence).binding);
						if (binding.kind === "WITNESS") yield* scopedEdge(binding.scopedEdge);
					}
				}
			}
		}
	}
}

function record(value: unknown): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("청사진 조립 관계의 구조가 유효하지 않습니다");
	}
	return value as Readonly<Record<string, unknown>>;
}

function array(value: unknown): readonly unknown[] {
	if (!Array.isArray(value)) throw new Error("청사진 조립 관계 배열이 누락되었습니다");
	return value;
}

function limit(count: number, maximum: number, label: string): void {
	if (count > maximum) {
		throw new Error(`청사진 ${label}은 최대 ${maximum.toLocaleString()}개까지 지원합니다`);
	}
}
