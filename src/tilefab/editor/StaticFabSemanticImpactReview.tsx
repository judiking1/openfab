import {
	type StaticFabReviewOrganizationLabels,
	staticFabReviewOrganizationLabel,
} from "./StaticFabSemanticImpactReviewLabels";
import "./StaticFabSemanticImpactReview.css";

interface ImpactRow {
	readonly label: string;
	readonly count: number;
	readonly samples: readonly (number | string)[];
}

const ORGANIZATION_TOTALS = new Set(["조직 전체", "Bank·하위 조직", "FAB·하위 조직", "다른 조직"]);
const ORGANIZATION_KINDS = new Set(["FAB", "Bank", "Bay", "Process Loop"]);
const CONTENT_KINDS = new Set(["레일 모듈", "소유 레일 모듈", "장비", "Port"]);
const CONNECTION_KINDS = new Set([
	"상위 FAB 소속",
	"연결 관계",
	"연결 corridor",
	"연결 레일 모듈",
	"방향 레일",
]);
const countLabel = (row: ImpactRow): string =>
	`${row.label === "연결 corridor" ? "연결 통로" : row.label === "Process Loop" ? "Loop" : row.label} ${row.count.toLocaleString()}개`;

export function StaticFabSemanticImpactReview({
	mode,
	removed,
	preserved,
	organizationLabels,
	connection,
}: Readonly<{
	mode: "delete" | "detach";
	removed: readonly ImpactRow[];
	preserved: readonly ImpactRow[];
	organizationLabels?: StaticFabReviewOrganizationLabels | null;
	connection?: Readonly<{ parentId: number; bankId: number }>;
}>): React.ReactElement {
	const summary = (rows: readonly ImpactRow[], kind: "removed" | "preserved") => {
		const total = rows.find((row) => ORGANIZATION_TOTALS.has(row.label));
		const names =
			total?.samples
				.filter((id): id is number => typeof id === "number")
				.slice(0, Math.min(total.count, 2)) ?? [];
		const kinds = rows.filter((row) => ORGANIZATION_KINDS.has(row.label) && row.count > 0);
		const content = rows.filter((row) => CONTENT_KINDS.has(row.label));
		const retainedBanks = rows.filter((row) => row.label === "남는 FAB의 Bank");
		const connections = rows.filter((row) => CONNECTION_KINDS.has(row.label) && row.count > 0);
		return (
			<section className="tilefab-review-summary-group" data-impact={kind}>
				<h3>
					{kind === "removed"
						? mode === "detach"
							? "분리되는 항목 · 연결 제거"
							: "삭제되는 항목"
						: "보존되는 항목"}
				</h3>
				{mode === "detach" && connection ? (
					<p className="tilefab-review-summary-names">
						{kind === "removed"
							? `${staticFabReviewOrganizationLabel(organizationLabels, connection.parentId)} ↔ ${staticFabReviewOrganizationLabel(organizationLabels, connection.bankId)}`
							: `${staticFabReviewOrganizationLabel(organizationLabels, connection.bankId)} 내부 구성 유지`}
					</p>
				) : names.length > 0 ? (
					<p className="tilefab-review-summary-names">
						{names
							.map((id) => staticFabReviewOrganizationLabel(organizationLabels, id))
							.join(" · ")}
						{total && total.count > names.length
							? ` 외 ${(total.count - names.length).toLocaleString()}개 조직`
							: ""}
					</p>
				) : null}
				{total ? (
					<p>
						조직 {total.count.toLocaleString()}개
						{kinds.length > 0 ? ` · ${kinds.map(countLabel).join(" · ")}` : ""}
					</p>
				) : null}
				{content.length > 0 ? <p>{content.map(countLabel).join(" · ")}</p> : null}
				{mode === "detach" && kind === "removed" ? (
					<p>{connections.map(countLabel).join(" · ")}</p>
				) : null}
				{mode === "detach" && kind === "preserved" && retainedBanks.length > 0 ? (
					<p>{retainedBanks.map(countLabel).join(" · ")}</p>
				) : null}
				{rows.length > 0 && rows.every((row) => row.count === 0) ? <p>해당 항목 없음</p> : null}
			</section>
		);
	};
	return (
		<div className="tilefab-review-impact-summary" data-testid="semantic-review-impact-summary">
			{summary(removed, "removed")}
			{summary(preserved, "preserved")}
		</div>
	);
}
