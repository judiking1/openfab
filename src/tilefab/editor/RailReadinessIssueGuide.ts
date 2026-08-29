import { PHYSICAL_PATH_IDENTITY_WIDTH } from "../compile/PhysicalPathIdentity";
import type {
	RailProjectReadiness,
	RailProjectReadinessIssue,
} from "../compile/RailProjectReadiness";
import type { RailMapReader } from "../core/paint";
import { terminalForwardDirection } from "../core/RailModulePlanner";
import type { Cell } from "../core/TileMap";

export type RailReadinessRepairTool = "build" | "inspect" | "replace-one-way" | null;
export type RailReadinessIssueRole = "primary" | "consequence";
export type RailReadinessHighlightKind = "fault" | "region" | "path" | "corridor";

export interface RailReadinessIssueCorridor {
	readonly cells: readonly Cell[];
	readonly departure: Readonly<{ from: Cell; to: Cell }>;
	readonly arrival: Readonly<{ from: Cell; to: Cell }>;
}

export interface RailReadinessIssueGuide {
	readonly title: string;
	readonly summary: string;
	readonly action: string;
	readonly metric: string;
	readonly repairTool: RailReadinessRepairTool;
	readonly repairLabel: string | null;
	readonly technicalLabel: string;
	readonly role: RailReadinessIssueRole;
	readonly causedByCode: RailProjectReadinessIssue["code"] | null;
	readonly highlightKind: RailReadinessHighlightKind;
}

/**
 * Translate deterministic readiness diagnostics into an editor action without changing the
 * fingerprinted report. The report remains the engineering truth; this object is UI presentation.
 */
export function railReadinessIssueGuide(
	report: RailProjectReadiness,
	issue: RailProjectReadinessIssue,
): RailReadinessIssueGuide {
	const count = issue.affectedCount.toLocaleString("en-US");
	if (issue.code === "EMPTY_PROJECT") {
		return guide(
			"START A RAIL NETWORK",
			"아직 검사할 레일이 없습니다.",
			"첫 폐루프 패턴을 배치하거나 레일 건설 도구로 폐쇄형 경로를 만드세요.",
			"NO RAIL",
			"build",
			"OPEN RAIL BUILD",
			"EMPTY PROJECT",
		);
	}
	if (issue.code === "OPEN_TERMINAL") {
		return guide(
			"CLOSE OPEN RAIL ENDS",
			`단방향 레일의 시작점 또는 진행 종료점이 ${count}개 열려 있습니다. 외형이 거의 루프여도 한 칸의 미연결 끝점이면 폐쇄망이 아닙니다.`,
			"진행이 끝나는 열린 끝점에서 이어 그려 호환되는 시작점에 합류시키세요. 시작점이 강조된 경우 가장 가까운 진행 종료점으로 이동해 건설을 시작합니다.",
			`${count} OPEN ${issue.affectedCount === 1 ? "END" : "ENDS"}`,
			"build",
			"CONTINUE RAIL",
			"OPEN TERMINAL",
		);
	}
	if (issue.code === "DISCONNECTED_NETWORK") {
		return guide(
			"JOIN SEPARATE RAIL NETWORKS",
			`각자 닫혀 보일 수 있지만 프로젝트가 물리적으로 떨어진 ${count}개 레일 네트워크로 나뉘어 있습니다.`,
			"두 네트워크 사이에 진행 방향을 보존하는 분기와 합류 브리지를 추가하세요.",
			`${count} NETWORKS`,
			"build",
			"BUILD A BRIDGE",
			"WEAK CONNECTIVITY",
			{ highlightKind: "region" },
		);
	}
	if (issue.code === "MULTIPLE_STRONG_COMPONENTS") {
		const physicallyJoined = report.summary.weakComponents === 1;
		const causedByOpenEnds = report.summary.openTerminals > 0;
		const causedBySeparateNetworks = report.summary.weakComponents > 1;
		const oneWayCorridor =
			physicallyJoined && !causedByOpenEnds && issue.sourceCode === "ONE_WAY_CORRIDOR";
		return guide(
			oneWayCorridor
				? "ONE-WAY BRIDGE NEEDS A RETURN LINK"
				: physicallyJoined
					? "FINISH THE OPEN FLOW"
					: "JOIN DIRECTED LOOPS",
			oneWayCorridor
				? `레일 선형 자체가 끊어진 것은 아닙니다. 강조된 단방향 연결 ${count}개는 한 순환망에서 다른 순환망으로 들어가는 길만 만들고, 반대로 돌아오는 길은 만들지 못했습니다. 화살표를 따라 전체 맵을 왕복 순환하려면 검증된 반대 방향 연결이 최소 ${report.summary.minimumReturnLinks.toLocaleString("en-US")}개 더 필요합니다.`
				: physicallyJoined
					? `열린 레일 끝 때문에 화살표를 따라 전체 경로를 순환할 수 없습니다.`
					: `분리된 폐루프를 포함해 단방향 흐름이 ${count}개 도달 구역으로 나뉘어 있습니다.`,
			oneWayCorridor
				? "강조된 ONE-WAY OUT–IN 단방향 브리지를 검증한 뒤 OUTBOUND와 RETURN 쌍으로 자동 교체하세요. 안전한 경로를 증명할 수 없으면 원본을 변경하지 않습니다."
				: physicallyJoined
					? "먼저 강조된 열린 끝점을 서로 연결해 폐루프를 완성하세요."
					: "각 루프를 한 방향으로 나가기만 하는 선이 아니라 분기와 합류가 모두 있는 브리지로 연결하세요.",
			oneWayCorridor
				? `${count} ONE-WAY ${issue.affectedCount === 1 ? "BRIDGE" : "BRIDGES"}`
				: `${count} FLOW REGIONS`,
			oneWayCorridor ? "replace-one-way" : "build",
			oneWayCorridor ? "AUTO REBUILD LINK" : physicallyJoined ? "CONTINUE RAIL" : "BUILD A BRIDGE",
			"DIRECTED CONNECTIVITY",
			{
				role: causedByOpenEnds || causedBySeparateNetworks ? "consequence" : "primary",
				causedByCode: causedByOpenEnds
					? "OPEN_TERMINAL"
					: causedBySeparateNetworks
						? "DISCONNECTED_NETWORK"
						: null,
				highlightKind: oneWayCorridor ? "corridor" : "region",
			},
		);
	}
	if (issue.code === "UNSUPPORTED_JUNCTION") {
		return guide(
			"REBUILD INVALID JUNCTION",
			`AMHS 접선 분기·합류 규격을 벗어난 교차점이 ${count}개 있습니다.`,
			"강조된 교차점을 선택해 철거한 뒤 진행 방향을 유지하는 분기 또는 합류 모듈로 다시 만드세요.",
			`${count} JUNCTIONS`,
			"inspect",
			"INSPECT JUNCTION",
			"JUNCTION GRAMMAR",
		);
	}
	if (issue.code === "CLEARANCE_CONFLICT") {
		return guide(
			"SEPARATE OVERLAPPING RAIL",
			`레일 빔, OHT 이동 공간 또는 설치 여유가 겹치는 충돌 구역이 ${count}개 있습니다.`,
			"강조된 두 경로 중 하나를 선택해 평행 이동하거나 충분한 셀 간격으로 다시 건설하세요.",
			`${count} CLEARANCE ${issue.affectedCount === 1 ? "CONFLICT" : "CONFLICTS"}`,
			"inspect",
			"INSPECT CONFLICT",
			technicalLabel(issue, "PHYSICAL CLEARANCE"),
			{ highlightKind: "path" },
		);
	}
	if (issue.code === "INVALID_PHYSICAL_PATH") {
		return guide(
			"REBUILD UNCOMPILED RAIL",
			`저작 레일 중 ${count}개 경로가 실제 곡선·직선 물리 경로로 변환되지 않았습니다.`,
			"강조된 레일 모듈을 선택해 철거한 뒤 카탈로그 모듈로 다시 건설하세요.",
			`${count} INVALID ${issue.affectedCount === 1 ? "PATH" : "PATHS"}`,
			"inspect",
			"INSPECT RAIL",
			"PHYSICAL COMPILATION",
			{ highlightKind: "path" },
		);
	}
	if (issue.code === "PHYSICAL_TERMINAL") {
		return guide(
			"CLOSE PHYSICAL RAIL ENDS",
			`화면의 물리 레일 경로가 ${count}개 끝점에서 더 이어지지 않습니다.`,
			"강조된 끝점의 레일 셀과 진행 방향을 검사하고 호환되는 모듈로 연결을 다시 만드세요.",
			`${count} PHYSICAL ENDS`,
			"inspect",
			"INSPECT END",
			"PHYSICAL TERMINAL",
			{
				role: report.summary.openTerminals > 0 ? "consequence" : "primary",
				causedByCode: report.summary.openTerminals > 0 ? "OPEN_TERMINAL" : null,
				highlightKind: "path",
			},
		);
	}
	if (issue.code === "PHYSICAL_OPEN_PATH") {
		return guide(
			"REPAIR PATH CONTINUITY",
			`컴파일된 레일 ${count}개가 다음 물리 경로로 완전히 이어지지 않습니다.`,
			"강조된 대표 경로 시작점에서 진행 방향을 따라가며 끊긴 끝을 찾고, 직선·커브·분기 모듈이 같은 방향과 접선으로 만나도록 다시 건설하세요.",
			`${count} OPEN ${issue.affectedCount === 1 ? "PATH" : "PATHS"}`,
			"inspect",
			"TRACE OPEN PATH",
			"PHYSICAL ADJACENCY",
			{
				role: report.summary.openTerminals > 0 ? "consequence" : "primary",
				causedByCode: report.summary.openTerminals > 0 ? "OPEN_TERMINAL" : null,
				highlightKind: "path",
			},
		);
	}
	if (issue.code === "PHYSICAL_DISCONNECTED") {
		const authoredAlreadySplit = report.summary.strongComponents !== 1;
		return guide(
			authoredAlreadySplit ? "PHYSICAL FLOW RECHECK" : "PHYSICAL FLOW IS SPLIT",
			authoredAlreadySplit
				? "물리 경로 검사는 현재 저작 방향망 문제의 파생 결과입니다. 별도로 고칠 두 번째 오류가 아닙니다."
				: `저작 방향망은 연결됐지만 실제 곡선·직선 경로가 ${count}개 흐름 구역으로 분리되어 있습니다.`,
			authoredAlreadySplit
				? "위의 ONE-WAY BRIDGE 또는 열린 끝점을 수정하면 물리 경로를 자동으로 다시 컴파일하고 이 항목을 재검사합니다."
				: "강조된 대표 경로 시작점에서 흐름을 추적하고 방향과 접선이 맞는 카탈로그 모듈로 다시 건설하세요.",
			authoredAlreadySplit ? "WAITING FOR FLOW FIX" : `${count} PHYSICAL REGIONS`,
			authoredAlreadySplit ? null : "inspect",
			authoredAlreadySplit ? null : "TRACE FLOW REGION",
			"PHYSICAL CONNECTIVITY",
			{
				role: authoredAlreadySplit ? "consequence" : "primary",
				causedByCode: authoredAlreadySplit ? "MULTIPLE_STRONG_COMPONENTS" : null,
				highlightKind: "path",
			},
		);
	}
	return guide(
		"REBUILD INVALID TOPOLOGY",
		"저작 레일과 물리 경로 사이에 변환할 수 없는 토폴로지 오류가 있습니다.",
		"강조된 모듈을 검사해 철거한 뒤 지원되는 직선·커브·분기·합류 모듈로 다시 건설하세요.",
		`${count} TOPOLOGY ${issue.affectedCount === 1 ? "ERROR" : "ERRORS"}`,
		"inspect",
		"INSPECT RAIL",
		technicalLabel(issue, "TOPOLOGY"),
	);
}

function guide(
	title: string,
	summary: string,
	action: string,
	metric: string,
	repairTool: RailReadinessRepairTool,
	repairLabel: string | null,
	technicalLabelValue: string,
	options: Readonly<{
		role?: RailReadinessIssueRole;
		causedByCode?: RailProjectReadinessIssue["code"] | null;
		highlightKind?: RailReadinessHighlightKind;
	}> = {},
): RailReadinessIssueGuide {
	return Object.freeze({
		title,
		summary,
		action,
		metric,
		repairTool,
		repairLabel,
		technicalLabel: technicalLabelValue,
		role: options.role ?? "primary",
		causedByCode: options.causedByCode ?? null,
		highlightKind: options.highlightKind ?? "fault",
	});
}

/** Read a complete navigation location lazily from the report's compact typed buffers. */
export function railReadinessIssueLocationCount(
	report: RailProjectReadiness,
	issue: RailProjectReadinessIssue,
): number {
	if (issue.code === "PHYSICAL_DISCONNECTED" && report.summary.strongComponents !== 1) return 0;
	const source = fullLocationSource(report, issue);
	if (source) return Math.floor(source.values.length / source.stride);
	if (
		(issue.code === "INVALID_PHYSICAL_PATH" || issue.code === "CLEARANCE_CONFLICT") &&
		issue.pathIdentities.length > 0
	) {
		return issue.pathIdentities.length;
	}
	return issue.cells.length;
}

export function railReadinessIssueLocationAt(
	report: RailProjectReadiness,
	issue: RailProjectReadinessIssue,
	index: number,
): Cell | null {
	if (!Number.isSafeInteger(index) || index < 0) return null;
	if (issue.code === "PHYSICAL_DISCONNECTED" && report.summary.strongComponents !== 1) return null;
	const source = fullLocationSource(report, issue);
	if (!source) {
		if (
			(issue.code === "INVALID_PHYSICAL_PATH" || issue.code === "CLEARANCE_CONFLICT") &&
			issue.pathIdentities[index]
		) {
			return {
				x: issue.pathIdentities[index]?.[2] as number,
				y: issue.pathIdentities[index]?.[3] as number,
			};
		}
		return issue.cells[index] ?? null;
	}
	const offset = index * source.stride;
	if (offset + source.yField >= source.values.length) return null;
	return {
		x: source.values[offset + source.xField] as number,
		y: source.values[offset + source.yField] as number,
	};
}

/** Return the exact authored corridor behind one one-way-flow diagnostic. */
export function railReadinessIssueCorridorAt(
	report: RailProjectReadiness,
	issue: RailProjectReadinessIssue,
	index: number,
): RailReadinessIssueCorridor | null {
	if (
		issue.code !== "MULTIPLE_STRONG_COMPONENTS" ||
		issue.sourceCode !== "ONE_WAY_CORRIDOR" ||
		!Number.isSafeInteger(index) ||
		index < 0
	) {
		return null;
	}
	const start = report.locations.oneWayCorridorOffsets[index];
	const end = report.locations.oneWayCorridorOffsets[index + 1];
	const boundaryOffset = index * 8;
	const values = report.locations.oneWayCorridorBoundaries;
	if (start === undefined || end === undefined || boundaryOffset + 7 >= values.length) return null;
	const cells: Cell[] = [];
	for (let cellIndex = start; cellIndex < end; cellIndex++) {
		cells.push(
			Object.freeze({
				x: report.locations.oneWayCorridorCells[cellIndex * 2] as number,
				y: report.locations.oneWayCorridorCells[cellIndex * 2 + 1] as number,
			}),
		);
	}
	return Object.freeze({
		cells: Object.freeze(cells),
		departure: Object.freeze({
			from: Object.freeze({
				x: values[boundaryOffset] as number,
				y: values[boundaryOffset + 1] as number,
			}),
			to: Object.freeze({
				x: values[boundaryOffset + 2] as number,
				y: values[boundaryOffset + 3] as number,
			}),
		}),
		arrival: Object.freeze({
			from: Object.freeze({
				x: values[boundaryOffset + 4] as number,
				y: values[boundaryOffset + 5] as number,
			}),
			to: Object.freeze({
				x: values[boundaryOffset + 6] as number,
				y: values[boundaryOffset + 7] as number,
			}),
		}),
	});
}

/** Return the exact compiled-path identity paired with a path diagnostic location. */
export function railReadinessIssuePathIdentityAt(
	report: RailProjectReadiness,
	issue: RailProjectReadinessIssue,
	index: number,
): Int32Array | null {
	if (!Number.isSafeInteger(index) || index < 0) return null;
	if (issue.code === "PHYSICAL_DISCONNECTED" && report.summary.strongComponents !== 1) return null;
	const values =
		issue.code === "PHYSICAL_OPEN_PATH"
			? report.locations.physicalOpenPathIdentities
			: issue.code === "PHYSICAL_DISCONNECTED"
				? report.locations.physicalStrongComponentPathIdentities
				: issue.code === "CLEARANCE_CONFLICT" &&
						report.issues.filter((candidate) => candidate.code === "CLEARANCE_CONFLICT").length <= 1
					? report.locations.clearancePathIdentities
					: null;
	if (values) {
		const offset = index * PHYSICAL_PATH_IDENTITY_WIDTH;
		if (offset + PHYSICAL_PATH_IDENTITY_WIDTH > values.length) return null;
		return values.slice(offset, offset + PHYSICAL_PATH_IDENTITY_WIDTH);
	}
	const sampled = issue.pathIdentities[index];
	return sampled ? sampled.slice() : null;
}

/** True when navigation covers the complete typed diagnostic, not only its bounded UI sample. */
export function railReadinessIssueLocationsAreComplete(
	report: RailProjectReadiness,
	issue: RailProjectReadinessIssue,
): boolean {
	if (fullLocationSource(report, issue) !== null) return true;
	if (issue.code === "CLEARANCE_CONFLICT") {
		return issue.pathIdentities.length === issue.affectedCount * 2;
	}
	if (issue.code === "INVALID_PHYSICAL_PATH") {
		return issue.pathIdentities.length === issue.affectedCount;
	}
	if (issue.code === "TOPOLOGY_ERROR") return false;
	return issue.cells.length >= issue.affectedCount;
}

/** Resolve a source-or-sink terminal diagnostic to the nearest sink that can seed construction. */
export function railReadinessOpenTerminalRepairLocation(
	report: RailProjectReadiness,
	issue: RailProjectReadinessIssue,
	map: RailMapReader,
	locationIndex: number,
): Readonly<{ index: number; cell: Cell }> | null {
	if (issue.code !== "OPEN_TERMINAL") return null;
	const focus = railReadinessIssueLocationAt(report, issue, locationIndex);
	if (focus && terminalForwardDirection(map, focus) !== null) {
		return Object.freeze({ index: locationIndex, cell: focus });
	}
	const locationCount = railReadinessIssueLocationCount(report, issue);
	let nearest: { index: number; cell: Cell } | null = null;
	let nearestDistance = Number.POSITIVE_INFINITY;
	for (let index = 0; index < locationCount; index++) {
		const candidate = railReadinessIssueLocationAt(report, issue, index);
		if (!candidate || terminalForwardDirection(map, candidate) === null) continue;
		const distance = focus
			? Math.abs(candidate.x - focus.x) + Math.abs(candidate.y - focus.y)
			: index;
		if (distance >= nearestDistance) continue;
		nearestDistance = distance;
		nearest = { index, cell: candidate };
	}
	return nearest ? Object.freeze(nearest) : null;
}

interface FullLocationSource {
	readonly values: Int32Array;
	readonly stride: number;
	readonly xField: number;
	readonly yField: number;
}

function fullLocationSource(
	report: RailProjectReadiness,
	issue: RailProjectReadinessIssue,
): FullLocationSource | null {
	const cells = (values: Int32Array): FullLocationSource => ({
		values,
		stride: 2,
		xField: 0,
		yField: 1,
	});
	const paths = (values: Int32Array): FullLocationSource => ({
		values,
		stride: PHYSICAL_PATH_IDENTITY_WIDTH,
		xField: 2,
		yField: 3,
	});
	if (issue.code === "OPEN_TERMINAL") return cells(report.locations.openTerminalCells);
	if (issue.code === "DISCONNECTED_NETWORK") {
		return cells(report.locations.componentRepresentativeCells);
	}
	if (issue.code === "MULTIPLE_STRONG_COMPONENTS") {
		return issue.sourceCode === "ONE_WAY_CORRIDOR"
			? {
					values: report.locations.oneWayCorridorBoundaries,
					stride: 8,
					xField: 0,
					yField: 1,
				}
			: cells(report.locations.strongComponentRepresentativeCells);
	}
	if (issue.code === "UNSUPPORTED_JUNCTION") {
		return cells(report.locations.unsupportedJunctionCells);
	}
	if (
		issue.code === "TOPOLOGY_ERROR" &&
		report.issues.filter((candidate) => candidate.code === "TOPOLOGY_ERROR").length <= 1
	) {
		return cells(report.locations.topologyErrorCells);
	}
	if (issue.code === "PHYSICAL_TERMINAL") return cells(report.locations.physicalTerminalCells);
	if (issue.code === "PHYSICAL_OPEN_PATH") {
		return paths(report.locations.physicalOpenPathIdentities);
	}
	if (issue.code === "PHYSICAL_DISCONNECTED") {
		return paths(report.locations.physicalStrongComponentPathIdentities);
	}
	if (
		issue.code === "CLEARANCE_CONFLICT" &&
		report.issues.filter((candidate) => candidate.code === "CLEARANCE_CONFLICT").length <= 1
	) {
		return paths(report.locations.clearancePathIdentities);
	}
	return null;
}

function technicalLabel(issue: RailProjectReadinessIssue, fallback: string): string {
	return issue.sourceCode ? issue.sourceCode.replaceAll("_", " ") : fallback;
}
