import type { RailDocument } from "../core/RailDocument";
import { deriveStaticFabOrganizationSemanticRoles } from "../core/StaticFabOrganization";

export type StaticFabReviewOrganizationLabels = Readonly<Record<number, string>>;

/** Snapshot display names only. This grants no review or mutation authority. */
export function captureStaticFabReviewOrganizationLabels(
	source: Pick<RailDocument, "map" | "organizations" | "getPatchSequence">,
	current: Pick<RailDocument, "map" | "organizations" | "getPatchSequence">,
	plan: Readonly<{ baseRevision: number; basePatchSequence: number }>,
): StaticFabReviewOrganizationLabels | null {
	if (
		source !== current ||
		source.map.getRevision() !== plan.baseRevision ||
		source.getPatchSequence() !== plan.basePatchSequence
	)
		return null;
	const organizations = source.organizations;
	const roles = deriveStaticFabOrganizationSemanticRoles(organizations);
	const names = new Map<number, string>();
	const occurrences = new Map<string, number>();
	for (const record of organizations.records) {
		const name = record.name.trim().replace(/\s+/g, " ");
		names.set(record.id, name);
		occurrences.set(name, (occurrences.get(name) ?? 0) + 1);
	}
	const labels: Record<number, string> = {};
	for (const record of organizations.records) {
		const name = names.get(record.id) ?? "";
		const role = roles.get(record.id);
		const kind =
			role === "BAY_BANK"
				? "Bank"
				: role === "PROCESS_LOOP"
					? "Loop"
					: role === "BAY"
						? "Bay"
						: role === "FAB"
							? "FAB"
							: record.kind;
		labels[record.id] =
			`${kind} ${name || "이름 없음"}${!name || (occurrences.get(name) ?? 0) > 1 ? ` (ID ${record.id})` : ""}`;
	}
	return Object.freeze(labels);
}

export function staticFabReviewOrganizationLabel(
	labels: StaticFabReviewOrganizationLabels | null | undefined,
	id: number,
): string {
	return labels?.[id] ?? `조직 ID ${id} (${labels ? "대상 없음" : "검토 시점 이름 확인 불가"})`;
}
