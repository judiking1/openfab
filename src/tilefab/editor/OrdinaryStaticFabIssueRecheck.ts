import type {
	StaticFabProjectCheckDomain,
	StaticFabProjectCheckIssue,
	StaticFabProjectCheckLocation,
	StaticFabProjectCheckLocationKind,
	StaticFabProjectChecks,
} from "../compile/StaticFabProjectChecks";
import type { RailDocument } from "../core/RailDocument";

export interface OrdinaryStaticFabIssueLocationIdentity {
	readonly kind: StaticFabProjectCheckLocationKind;
	readonly entityId: number;
	readonly recordIndex: number;
	readonly occurrenceIndex: number;
	readonly relatedKind: StaticFabProjectCheckLocationKind | null;
	readonly relatedEntityId: number;
	readonly relatedRecordIndex: number;
	readonly token: string | null;
	readonly minX: number;
	readonly minZ: number;
	readonly maxX: number;
	readonly maxZ: number;
}

export interface OrdinaryStaticFabIssueIdentity {
	readonly id: string;
	readonly code: StaticFabProjectCheckIssue["code"];
	readonly domain: StaticFabProjectCheckDomain;
	readonly sourceCode: string;
}

/**
 * Runtime-only context for returning from an existing Inspector to a fresh current-source check.
 * It deliberately keeps only bounded scalar identity and the live document reference. It is not a
 * persisted receipt and it grants no authority to mutate or acknowledge a check.
 */
export interface OrdinaryStaticFabIssueRecheckContext {
	readonly projectId: string;
	readonly document: RailDocument;
	readonly originSourceKey: string;
	readonly checksFingerprint: string;
	readonly issue: OrdinaryStaticFabIssueIdentity;
	readonly locationIndex: number;
	readonly location: OrdinaryStaticFabIssueLocationIdentity;
}

export interface OrdinaryStaticFabIssueRecheckPresentation {
	readonly action: "recheck-current-static-fab-source";
	readonly state: "waiting" | "ready";
	readonly disabled: boolean;
	readonly label: string;
	readonly instruction: string;
	readonly ariaLabel: string;
	readonly description: string;
}

export type OrdinaryStaticFabIssueRecheckResolution =
	| Readonly<{
			state: "same-location";
			issue: StaticFabProjectCheckIssue;
			locationIndex: number;
	  }>
	| Readonly<{
			state: "same-issue";
			issue: StaticFabProjectCheckIssue;
			locationIndex: 0;
	  }>
	| Readonly<{
			state: "resolved";
	  }>;

const MAXIMUM_RECHECK_LOCATION_SCAN = 1_024;

export function beginOrdinaryStaticFabIssueRecheck(
	projectId: string,
	document: RailDocument,
	sourceKey: string,
	checks: StaticFabProjectChecks,
	issue: StaticFabProjectCheckIssue,
	locationIndex: number,
): OrdinaryStaticFabIssueRecheckContext | null {
	const currentIssue = checks.issues.find((candidate) => issueIdentityMatches(candidate, issue));
	if (!currentIssue || currentIssue.locationCount <= 0) return null;
	const boundedLocationIndex = Math.min(Math.max(0, locationIndex), currentIssue.locationCount - 1);
	const location = checks.readLocation(currentIssue, boundedLocationIndex);
	if (!location) return null;
	return Object.freeze({
		projectId,
		document,
		originSourceKey: sourceKey,
		checksFingerprint: checks.fingerprint,
		issue: Object.freeze({
			id: currentIssue.id,
			code: currentIssue.code,
			domain: currentIssue.domain,
			sourceCode: currentIssue.sourceCode,
		}),
		locationIndex: boundedLocationIndex,
		location: locationIdentity(location),
	});
}

export function ordinaryStaticFabIssueRecheckContextMatchesProject(
	context: OrdinaryStaticFabIssueRecheckContext,
	projectId: string,
	document: RailDocument,
): boolean {
	return context.projectId === projectId && context.document === document;
}

export function ordinaryStaticFabIssueRecheckPresentation(
	context: OrdinaryStaticFabIssueRecheckContext | null,
	options: Readonly<{
		projectId: string;
		document: RailDocument;
		currentSourceKey: string;
		guidedBuildActive: boolean;
		navigatorOpen: boolean;
		contextualInspectorVisible: boolean;
		organizationInspectorVisible: boolean;
		exclusiveCommandActive: boolean;
		view2d: boolean;
		readyForRecheck: boolean;
	}>,
): OrdinaryStaticFabIssueRecheckPresentation | null {
	if (
		!context ||
		!ordinaryStaticFabIssueRecheckContextMatchesProject(
			context,
			options.projectId,
			options.document,
		) ||
		options.guidedBuildActive ||
		options.navigatorOpen ||
		options.contextualInspectorVisible ||
		options.organizationInspectorVisible ||
		options.exclusiveCommandActive ||
		!options.view2d
	) {
		return null;
	}
	const sourceChanged = context.originSourceKey !== options.currentSourceKey;
	if (!sourceChanged || !options.readyForRecheck) {
		return Object.freeze({
			action: "recheck-current-static-fab-source",
			state: "waiting",
			disabled: true,
			label: "수정 후 · 다시 검사",
			instruction: sourceChanged
				? "수리 반영과 Worker 동기화를 기다리는 중"
				: "Inspector에서 필요한 편집을 완료하세요",
			ariaLabel: sourceChanged
				? "현재 프로젝트 다시 검사. 수리 반영과 Worker 동기화를 기다리는 중입니다"
				: "현재 프로젝트 다시 검사. Inspector에서 필요한 편집을 완료한 뒤 사용할 수 있습니다",
			description:
				"검사 항목을 자동으로 고치지 않습니다. 기존 Inspector에서 명시적으로 편집한 현재 프로젝트 소스만 다시 검사합니다.",
		});
	}
	return Object.freeze({
		action: "recheck-current-static-fab-source",
		state: "ready",
		disabled: false,
		label: "다음 · 현재 프로젝트 다시 검사",
		instruction: "수정한 현재 소스에서 선택 문제의 잔존·해결 확인",
		ariaLabel:
			"다음 · 현재 프로젝트 다시 검사. 수정한 현재 소스에서 선택했던 문제의 잔존 또는 해결을 확인합니다",
		description:
			"현재 프로젝트의 새 소스 identity로 CHECKS를 다시 실행합니다. 선택 문제가 사라져도 다른 문제가 남을 수 있습니다.",
	});
}

export function resolveOrdinaryStaticFabIssueRecheck(
	context: OrdinaryStaticFabIssueRecheckContext,
	checks: StaticFabProjectChecks,
): OrdinaryStaticFabIssueRecheckResolution {
	const issue = checks.issues.find((candidate) => issueIdentityMatches(candidate, context.issue));
	if (!issue) return Object.freeze({ state: "resolved" });
	const originalLocation = checks.readLocation(issue, context.locationIndex);
	if (originalLocation && locationIdentityMatches(originalLocation, context.location)) {
		return Object.freeze({
			state: "same-location",
			issue,
			locationIndex: context.locationIndex,
		});
	}
	const scanCount = Math.min(issue.locationCount, MAXIMUM_RECHECK_LOCATION_SCAN);
	for (let locationIndex = 0; locationIndex < scanCount; locationIndex++) {
		if (locationIndex === context.locationIndex) continue;
		const location = checks.readLocation(issue, locationIndex);
		if (location && locationIdentityMatches(location, context.location)) {
			return Object.freeze({ state: "same-location", issue, locationIndex });
		}
	}
	return Object.freeze({ state: "same-issue", issue, locationIndex: 0 });
}

export function describeOrdinaryStaticFabIssueRecheckResolution(
	resolution: OrdinaryStaticFabIssueRecheckResolution,
	projectIssueCount: number,
	railIssueCount: number,
): string {
	const remainingIssueCount = Math.max(0, projectIssueCount) + Math.max(0, railIssueCount);
	if (resolution.state === "same-location") {
		return `선택했던 문제와 위치가 현재 검사에도 남아 있습니다 · 전체 ${remainingIssueCount}개`;
	}
	if (resolution.state === "same-issue") {
		return `선택했던 문제 유형이 현재 검사에도 남아 있습니다 · 전체 ${remainingIssueCount}개`;
	}
	return remainingIssueCount === 0
		? "선택했던 문제가 현재 소스에서 사라졌습니다 · 전체 검사 통과"
		: `선택했던 문제가 현재 소스에서 사라졌습니다 · 다른 검사 ${remainingIssueCount}개 남음`;
}

function issueIdentityMatches(
	left: Pick<StaticFabProjectCheckIssue, "id" | "code" | "domain" | "sourceCode">,
	right: Pick<StaticFabProjectCheckIssue, "id" | "code" | "domain" | "sourceCode">,
): boolean {
	return (
		left.id === right.id &&
		left.code === right.code &&
		left.domain === right.domain &&
		left.sourceCode === right.sourceCode
	);
}

function locationIdentity(
	location: StaticFabProjectCheckLocation,
): OrdinaryStaticFabIssueLocationIdentity {
	return Object.freeze({
		kind: location.kind,
		entityId: location.entityId,
		recordIndex: location.recordIndex,
		occurrenceIndex: location.occurrenceIndex,
		relatedKind: location.relatedKind,
		relatedEntityId: location.relatedEntityId,
		relatedRecordIndex: location.relatedRecordIndex,
		token: location.token,
		minX: location.bounds.minX,
		minZ: location.bounds.minZ,
		maxX: location.bounds.maxX,
		maxZ: location.bounds.maxZ,
	});
}

function locationIdentityMatches(
	location: StaticFabProjectCheckLocation,
	identity: OrdinaryStaticFabIssueLocationIdentity,
): boolean {
	const spatialIdentity =
		location.bounds.minX === identity.minX &&
		location.bounds.minZ === identity.minZ &&
		location.bounds.maxX === identity.maxX &&
		location.bounds.maxZ === identity.maxZ;
	const primaryIdentity =
		location.kind === "project" || location.kind === "rail"
			? spatialIdentity
			: location.entityId === identity.entityId && spatialIdentity;
	return (
		location.kind === identity.kind &&
		primaryIdentity &&
		location.relatedKind === identity.relatedKind &&
		location.relatedEntityId === identity.relatedEntityId &&
		location.token === identity.token
	);
}
