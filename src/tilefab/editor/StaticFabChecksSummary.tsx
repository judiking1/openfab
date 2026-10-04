import { AlertTriangle, Check, RefreshCcw } from "lucide-react";
import type { ReactElement } from "react";
import type { RailProjectReadiness } from "../compile/RailProjectReadiness";
import type { StaticFabProjectChecksSummary } from "../compile/StaticFabProjectChecks";

interface StaticFabChecksSummaryProps {
	readonly readiness: RailProjectReadiness;
	readonly readinessActionCount: number;
	readonly projectSummary: StaticFabProjectChecksSummary | null;
	readonly inspectionError: string | null;
	readonly checkStatus: "error" | "checking" | "unchecked" | "ready" | "issues";
	readonly pendingLabel: string;
}

export function StaticFabChecksSummary({
	readiness,
	readinessActionCount,
	projectSummary,
	inspectionError,
	checkStatus,
	pendingLabel,
}: StaticFabChecksSummaryProps): ReactElement {
	return (
		<dl className="tilefab-readiness-checks">
			<ReadinessCheck
				label="레일 흐름"
				passed={readiness.ready}
				value={
					readiness.ready
						? "통과"
						: readiness.status === "empty"
							? "레일 없음"
							: readinessActionCount > 0
								? `수정 ${readinessActionCount}건`
								: `문제 ${readiness.issues.length}건`
				}
			/>
			<ReadinessCheck
				label="레일 간격"
				passed={readiness.summary.clearanceIssues === 0}
				value={
					readiness.summary.clearanceIssues === 0
						? "통과"
						: `${readiness.summary.clearanceIssues}건 확인`
				}
			/>
			<ReadinessCheck
				label="분기·합류"
				state={
					!projectSummary ? "pending" : projectSummary.switchIssueCount === 0 ? "pass" : "fail"
				}
				value={
					!projectSummary
						? pendingLabel
						: projectSummary.switchIssueCount === 0
							? `${projectSummary.advancedSwitchCount}개 통과`
							: `${projectSummary.switchIssueCount}건 확인`
				}
			/>
			<ReadinessCheck
				label="포트 연결"
				state={
					!projectSummary?.portChecksComplete
						? "pending"
						: projectSummary.portIssueCount === 0
							? "pass"
							: "fail"
				}
				value={
					!projectSummary
						? pendingLabel
						: !projectSummary.portChecksComplete
							? "데이터 오류 먼저 수정"
							: projectSummary.portIssueCount === 0
								? `${projectSummary.portCount}개 통과`
								: `${projectSummary.portIssueCount}건 확인`
				}
			/>
			<ReadinessCheck
				label="장비"
				state={
					!projectSummary?.equipmentChecksComplete
						? "pending"
						: projectSummary.equipmentIssueCount === 0
							? "pass"
							: "fail"
				}
				value={
					!projectSummary
						? pendingLabel
						: !projectSummary.equipmentChecksComplete
							? "데이터 오류 먼저 수정"
							: projectSummary.equipmentIssueCount === 0
								? `${projectSummary.equipmentGroupCount}개 통과`
								: `${projectSummary.equipmentIssueCount}건 확인`
				}
			/>
			<ReadinessCheck
				label="구조 소속"
				state={
					!projectSummary?.organizationChecksComplete
						? "pending"
						: projectSummary.organizationIssueCount === 0
							? "pass"
							: "fail"
				}
				value={
					!projectSummary
						? pendingLabel
						: !projectSummary.organizationChecksComplete
							? "장비 오류 먼저 수정"
							: projectSummary.organizationIssueCount === 0
								? `${projectSummary.organizationCount}개 통과`
								: `${projectSummary.organizationIssueCount}건 확인`
				}
			/>
			<ReadinessCheck
				label="계층"
				state={
					!projectSummary ? "pending" : projectSummary.hierarchyIssueCount === 0 ? "pass" : "fail"
				}
				value={
					!projectSummary
						? pendingLabel
						: projectSummary.hierarchyIssueCount === 0
							? "확인 완료"
							: `${projectSummary.hierarchyIssueCount}건 확인`
				}
			/>
			<ReadinessCheck
				label="검사 기준"
				state={inspectionError ? "fail" : projectSummary ? "pass" : "pending"}
				value={
					inspectionError
						? "검사 실패"
						: projectSummary
							? "현재 프로젝트"
							: checkStatus === "unchecked"
								? "검사 필요"
								: "검사 중"
				}
			/>
		</dl>
	);
}

function ReadinessCheck({
	label,
	passed,
	state,
	value,
}: Readonly<{
	label: string;
	passed?: boolean;
	state?: "pass" | "fail" | "pending";
	value: string;
}>): ReactElement {
	const resolvedState = state ?? (passed ? "pass" : "fail");
	return (
		<div data-state={resolvedState}>
			<dt>
				{resolvedState === "pass" ? (
					<Check size={12} aria-hidden="true" />
				) : resolvedState === "pending" ? (
					<RefreshCcw size={12} aria-hidden="true" />
				) : (
					<AlertTriangle size={12} aria-hidden="true" />
				)}
				{label}
			</dt>
			<dd>{value}</dd>
		</div>
	);
}
