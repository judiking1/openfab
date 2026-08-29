import type {
	StaticFabProjectCheckIssue,
	StaticFabProjectCheckLocation,
	StaticFabProjectChecks,
} from "../compile/StaticFabProjectChecks";
import type {
	StaticFabOrganizationRecord,
	StaticFabOrganizationState,
} from "../core/StaticFabOrganization";

export interface StaticFabProjectCheckGuide {
	readonly title: string;
	readonly summary: string;
	readonly action: string;
	readonly metric: string;
	readonly technicalLabel: string;
	readonly role: StaticFabProjectCheckIssue["role"];
}

/** ID-only editor selection is unsafe while any port or equipment identity is duplicated. */
export function staticFabProjectChecksHaveAmbiguousPortEquipmentIdentity(
	checks: Pick<StaticFabProjectChecks, "issues">,
): boolean {
	return checks.issues.some(
		(issue) =>
			issue.code === "PORT_EQUIPMENT_INTEGRITY" &&
			(issue.sourceCode === "PORT_ID_DUPLICATE" ||
				issue.sourceCode === "EQUIPMENT_GROUP_ID_DUPLICATE"),
	);
}

/** ID-only organization navigation is unsafe while any authored organization ID is duplicated. */
export function staticFabProjectChecksHaveAmbiguousOrganizationIdentity(
	checks: Pick<StaticFabProjectChecks, "issues">,
): boolean {
	return checks.issues.some(
		(issue) =>
			issue.code === "ORGANIZATION_INTEGRITY" && issue.sourceCode === "ORGANIZATION_ID_DUPLICATE",
	);
}

/** Resolve one exact organization row without falling back from a stale record index to an ID. */
export function staticFabProjectCheckOrganizationTarget(
	checks: Pick<StaticFabProjectChecks, "issues">,
	location: StaticFabProjectCheckLocation,
	organizations: StaticFabOrganizationState,
): StaticFabOrganizationRecord | null {
	if (
		location.kind !== "organization" ||
		location.recordIndex < 0 ||
		staticFabProjectChecksHaveAmbiguousOrganizationIdentity(checks)
	) {
		return null;
	}
	const indexed = organizations.records[location.recordIndex];
	if (!indexed || indexed.id !== location.entityId) return null;
	let matches = 0;
	for (const record of organizations.records) {
		if (record.id === location.entityId) matches++;
		if (matches > 1) return null;
	}
	return matches === 1 ? indexed : null;
}

export function staticFabOrganizationIssueDetailTab(
	sourceCode: string,
): "overview" | "relations" | "properties" {
	if (
		sourceCode.startsWith("ORGANIZATION_PARENT_") ||
		sourceCode.startsWith("ORGANIZATION_RELATIONSHIP_")
	) {
		return "relations";
	}
	if (
		sourceCode === "ORGANIZATION_NAME_DUPLICATE" ||
		sourceCode === "ORGANIZATION_METADATA_INVALID" ||
		sourceCode === "ORGANIZATION_RECORD_INVALID" ||
		sourceCode === "ORGANIZATION_RECORD_ORDER_NONCANONICAL" ||
		sourceCode.startsWith("NEXT_ORGANIZATION_ID_")
	) {
		return "properties";
	}
	return "overview";
}

/** UI-only explanation for immutable Worker-derived project checks. */
export function staticFabProjectCheckGuide(
	_checks: StaticFabProjectChecks,
	issue: StaticFabProjectCheckIssue,
	detailOverride?: string,
): StaticFabProjectCheckGuide {
	const count = issue.affectedCount.toLocaleString("en-US");
	const detail = detailOverride?.trim() || issue.detail;
	if (issue.code === "ADVANCED_SWITCH_TOPOLOGY") {
		return guide(
			"REBUILD INVALID SWITCH",
			`고급 스위치 ${count}곳의 내부 이동 또는 예약 셀이 카탈로그 규격과 다릅니다.`,
			"강조된 스위치를 검사하고 삭제한 뒤 같은 방향의 정식 분기·합류 모듈로 다시 설치하세요.",
			`${count} SWITCH ${issue.affectedCount === 1 ? "FAULT" : "FAULTS"}`,
			`SWITCH · ${issue.sourceCode}`,
			issue.role,
		);
	}
	if (issue.code === "PORT_ATTACHMENT") {
		const consequence = issue.role === "consequence";
		return guide(
			consequence ? "PORTS WAITING FOR RAIL REPAIR" : "REATTACH UNREACHABLE PORTS",
			consequence
				? `레일 물리 경로 문제가 남아 있어 ${count}개 포트의 최종 station을 확정할 수 없습니다.`
				: `${count}개 포트의 저장된 route/station이 현재 물리 레일 위의 한 지점으로 해석되지 않습니다.`,
			consequence
				? "먼저 RAIL 그룹의 주 원인을 수정하세요. 같은 프로젝트 세대가 다시 컴파일되면 포트 도달성을 자동 재검사합니다."
				: "강조된 포트를 선택해 유효한 레일 slot으로 이동하거나 해당 포트의 레일 모듈을 다시 건설하세요.",
			`${count} UNREACHABLE ${issue.affectedCount === 1 ? "PORT" : "PORTS"}`,
			`PORT REACH · ${portFailureLabel(issue.sourceCode)}`,
			issue.role,
		);
	}
	if (issue.code === "EQUIPMENT_PARTIAL_ATTACHMENT") {
		return guide(
			"COMPLETE EQUIPMENT PORT ATTACHMENTS",
			`${count}개 장비 그룹에 물리 레일로 해석되지 않는 member port가 포함되어 있습니다. 장비 본체는 모든 포트가 확정될 때까지 신뢰할 수 없습니다.`,
			"위 PORT REACH 문제를 먼저 수정하세요. 마지막 member port가 연결되면 장비 범위와 선택 영역을 자동으로 다시 계산합니다.",
			`${count} PARTIAL ${issue.affectedCount === 1 ? "GROUP" : "GROUPS"}`,
			"EQUIPMENT RECIPROCITY",
			issue.role,
		);
	}
	if (issue.code === "PORT_EQUIPMENT_INTEGRITY") {
		return guide(
			portEquipmentIntegrityTitle(issue.sourceCode),
			`${detail} 작업 가능한 엔티티가 있으면 위치별 검사기로 열어 저장된 관계를 확인할 수 있습니다.`,
			"이 오류는 일반 배치 명령으로 자동 복구하지 않습니다. 강조된 엔티티를 확인한 뒤 마지막 유효한 undo 지점으로 돌아가거나 원본 프로젝트를 다시 여세요.",
			`${count} INTEGRITY ${issue.affectedCount === 1 ? "FAULT" : "FAULTS"}`,
			`PORT / EQUIPMENT · ${issue.sourceCode}`,
			issue.role,
		);
	}
	if (issue.code === "PORT_EQUIPMENT_LAYOUT") {
		return portEquipmentLayoutGuide(issue, count, detail);
	}
	if (issue.code === "ORGANIZATION_INTEGRITY") {
		return organizationIntegrityGuide(issue, count, detail);
	}
	if (issue.code === "HIERARCHY_AMBIGUOUS") {
		return guide(
			"CHOOSE PROCESS-ROW PAIRING",
			`Factory topology에서 동등한 Process Row 결합 후보가 ${count}곳 발견되어 Bank/Block을 임의로 추론하지 않았습니다.`,
			"강조된 Factory 영역을 선택하고 계층 메뉴에서 실제 공정 의도에 맞는 Row pairing 하나를 명시적으로 선택하세요.",
			`${count} AMBIGUOUS ${issue.affectedCount === 1 ? "FACTORY" : "FACTORIES"}`,
			"DERIVED HIERARCHY",
			issue.role,
		);
	}
	return guide(
		"REBUILD HIERARCHY INDEX",
		"현재 레일 소유권에서 정적 FAB 계층 후보를 안전하게 파생하지 못했습니다.",
		"강조된 범위의 겹침·불완전 레일을 먼저 수정한 뒤 CHECKS를 다시 여세요.",
		`${count} HIERARCHY ${issue.affectedCount === 1 ? "FAULT" : "FAULTS"}`,
		"HIERARCHY DERIVATION",
		issue.role,
	);
}

function organizationIntegrityGuide(
	issue: StaticFabProjectCheckIssue,
	count: string,
	detail: string,
): StaticFabProjectCheckGuide {
	const metric = `${count} ORGANIZATION ${issue.affectedCount === 1 ? "FAULT" : "FAULTS"}`;
	const technicalLabel = `ORGANIZATION · ${issue.sourceCode}`;
	if (issue.sourceCode.startsWith("NEXT_ORGANIZATION_ID_")) {
		return guide(
			"RESTORE ORGANIZATION ID CURSOR",
			detail,
			"이 프로젝트 세대는 새 조직 ID를 안전하게 할당할 수 없습니다. 마지막 유효한 undo 지점으로 돌아가거나 원본 프로젝트를 다시 여세요.",
			metric,
			technicalLabel,
			issue.role,
		);
	}
	if (issue.sourceCode === "ORGANIZATION_ID_DUPLICATE") {
		return guide(
			"RESTORE UNIQUE ORGANIZATION IDS",
			detail,
			"동일 ID의 레코드를 임의 선택하지 않습니다. 마지막 유효한 undo 지점으로 돌아가거나 원본 프로젝트를 다시 열어 고유 ID를 복구하세요.",
			metric,
			technicalLabel,
			issue.role,
		);
	}
	if (issue.sourceCode === "ORGANIZATION_NAME_DUPLICATE") {
		return guide(
			"RENAME DUPLICATE ORGANIZATION",
			detail,
			"OPEN ORGANIZATION을 눌러 같은 종류 안에서 중복되지 않는 이름으로 변경한 뒤 저장하세요.",
			metric,
			technicalLabel,
			issue.role,
		);
	}
	if (
		issue.sourceCode === "ORGANIZATION_RECORD_INVALID" ||
		issue.sourceCode === "ORGANIZATION_RECORD_ORDER_NONCANONICAL" ||
		issue.sourceCode === "ORGANIZATION_METADATA_INVALID"
	) {
		return guide(
			"REPAIR ORGANIZATION RECORD",
			detail,
			"강조된 레코드의 이름·종류·설명·색상을 확인하세요. 레코드 순서나 ID 자체가 손상됐다면 원본 프로젝트를 다시 여세요.",
			metric,
			technicalLabel,
			issue.role,
		);
	}
	if (
		issue.sourceCode.startsWith("ORGANIZATION_PARENT_") ||
		issue.sourceCode.startsWith("ORGANIZATION_RELATIONSHIP_")
	) {
		return guide(
			"REPAIR ORGANIZATION RELATIONS",
			detail,
			"OPEN ORGANIZATION의 RELATIONS 탭에서 존재하는 상위 조직만 남기고 자기 참조·중복·순환 관계를 제거한 뒤 저장하세요.",
			metric,
			technicalLabel,
			issue.role,
		);
	}
	if (issue.sourceCode === "ORGANIZATION_SAME_KIND_OWNERSHIP_CONFLICT") {
		return guide(
			"SEPARATE DIRECT OWNERSHIP",
			detail,
			"OPEN ORGANIZATION에서 같은 종류의 두 조직이 함께 소유한 정확한 token을 확인하고 한쪽 direct coverage에서 제거하세요.",
			metric,
			technicalLabel,
			issue.role,
		);
	}
	if (
		issue.sourceCode === "ORGANIZATION_MODULE_PARTIAL" ||
		issue.sourceCode === "ORGANIZATION_MEMBERSHIP_MODULE_UNRESOLVED"
	) {
		return guide(
			"RESTORE COMPLETE RAIL MODULE OWNERSHIP",
			detail,
			"강조된 semantic module의 모든 directed edge와 switch를 한 조직의 direct coverage로 다시 선택하세요.",
			metric,
			technicalLabel,
			issue.role,
		);
	}
	return guide(
		"REPAIR ORGANIZATION MEMBERSHIP",
		detail,
		"OPEN ORGANIZATION에서 강조된 rail·switch·equipment·port token을 확인하고 현재 프로젝트에 존재하는 완전한 direct coverage로 다시 저장하세요.",
		metric,
		technicalLabel,
		issue.role,
	);
}

function portEquipmentIntegrityTitle(sourceCode: string): string {
	switch (sourceCode) {
		case "NEXT_PORT_ID_CURSOR_INVALID":
		case "NEXT_PORT_ID_CURSOR_STALE":
		case "NEXT_EQUIPMENT_GROUP_ID_CURSOR_INVALID":
		case "NEXT_EQUIPMENT_GROUP_ID_CURSOR_STALE":
			return "RESTORE ID ALLOCATION CURSOR";
		case "PORT_RECORD_INVALID":
			return "REPAIR INVALID PORT RECORD";
		case "EQUIPMENT_GROUP_RECORD_INVALID":
			return "REPAIR INVALID EQUIPMENT RECORD";
		case "PORT_ID_DUPLICATE":
		case "PORT_BARCODE_DUPLICATE":
			return "RESTORE UNIQUE PORT IDENTITIES";
		case "EQUIPMENT_GROUP_ID_DUPLICATE":
			return "RESTORE UNIQUE EQUIPMENT IDENTITIES";
		case "EQUIPMENT_GROUP_PORT_MISSING":
		case "PORT_EQUIPMENT_GROUP_MISSING":
			return "RESTORE MISSING PORT OWNERSHIP";
		case "PORT_GROUP_TYPE_MISMATCH":
			return "MATCH PORT AND EQUIPMENT TYPES";
		case "PORT_OWNED_BY_MULTIPLE_GROUPS":
		case "PORT_GROUP_POINTER_MISMATCH":
		case "PORT_NOT_OWNED_BY_GROUP":
			return "RESTORE RECIPROCAL PORT OWNERSHIP";
		default:
			return "REVIEW PORT AND EQUIPMENT INTEGRITY";
	}
}

function portEquipmentLayoutGuide(
	issue: StaticFabProjectCheckIssue,
	count: string,
	detail: string,
): StaticFabProjectCheckGuide {
	const metric = `${count} LAYOUT ${issue.affectedCount === 1 ? "FAULT" : "FAULTS"}`;
	const technicalLabel = `EQUIPMENT LAYOUT · ${issue.sourceCode}`;
	if (issue.sourceCode === "PORT_ROUTE_MISSING") {
		return guide(
			"REATTACH PORT TO AUTHORED RAIL",
			detail,
			"OPEN PORT INSPECTOR를 누르세요. OHB는 유효한 레일 slot으로 이동하고, EQ/STK는 그룹 전체를 합법 슬롯으로 이동하거나 삭제 후 다시 배치하세요. 필요하면 포트가 참조하던 레일 모듈을 먼저 복구하세요.",
			metric,
			technicalLabel,
			issue.role,
		);
	}
	if (issue.sourceCode === "PORT_STATION_OCCUPIED" || issue.sourceCode === "PORT_SPACING") {
		return guide(
			"SEPARATE CONFLICTING PORTS",
			detail,
			"위치 화살표로 충돌 포트를 번갈아 확인하세요. OHB는 개별 포트를 인접 slot으로 이동하고, EQ/STK는 그룹 전체 이동 또는 포트 구성 편집으로 최소 간격을 확보하세요.",
			metric,
			technicalLabel,
			issue.role,
		);
	}
	if (issue.sourceCode === "EQ_STK_BODY_OVERLAP") {
		return guide(
			"SEPARATE EQUIPMENT RESERVATIONS",
			detail,
			"위치 화살표로 겹친 EQ 본체와 STK 예약 범위를 확인하고 한 그룹을 이동하거나 포트 구성을 줄여 두 장비의 점유 영역을 분리하세요.",
			metric,
			technicalLabel,
			issue.role,
		);
	}
	if (issue.sourceCode.startsWith("EQ_")) {
		return guide(
			"REBUILD EQ PORT ROW",
			detail,
			"OPEN EQUIPMENT INSPECTOR에서 포트 구성 편집을 시작해 같은 직선·방향·CENTER lane과 정확한 pitch로 행을 다시 확정하세요.",
			metric,
			technicalLabel,
			issue.role,
		);
	}
	if (issue.sourceCode.startsWith("STK_") && !issue.sourceCode.startsWith("STK_RESERVATION_")) {
		return guide(
			"REBUILD STK PORT GROUP",
			detail,
			"OPEN EQUIPMENT INSPECTOR에서 각 직선 run 안의 연속성과 canonical travel 순서를 유지하도록 그룹 포트를 다시 선택하세요.",
			metric,
			technicalLabel,
			issue.role,
		);
	}
	return guide(
		"SEPARATE EQUIPMENT RESERVATIONS",
		detail,
		"위치 화살표로 충돌하는 두 장비를 확인하고 한 그룹을 이동하거나 포트 구성을 줄여 본체·STK 예약 범위가 겹치지 않게 하세요.",
		metric,
		technicalLabel,
		issue.role,
	);
}

function guide(
	title: string,
	summary: string,
	action: string,
	metric: string,
	technicalLabel: string,
	role: StaticFabProjectCheckIssue["role"],
): StaticFabProjectCheckGuide {
	return Object.freeze({ title, summary, action, metric, technicalLabel, role });
}

function portFailureLabel(code: string): string {
	if (code === "SOURCE_NOT_FOUND") return "ROUTE MISSING";
	if (code === "SOURCE_AMBIGUOUS") return "ROUTE AMBIGUOUS";
	if (code === "STATION_OUT_OF_RANGE") return "STATION RANGE";
	if (code === "UNMAPPABLE_INTERVAL") return "SUPPORT INTERVAL";
	if (code === "TARGET_PATH_INVALID") return "PHYSICAL TARGET";
	if (code === "TARGET_AMBIGUOUS") return "TARGET AMBIGUOUS";
	if (code === "SAMPLE_FAILED") return "PATH SAMPLE";
	return "INVALID STATION";
}
