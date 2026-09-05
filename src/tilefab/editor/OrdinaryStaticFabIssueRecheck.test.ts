import { describe, expect, it } from "vitest";
import type {
	StaticFabProjectCheckIssue,
	StaticFabProjectCheckLocation,
	StaticFabProjectChecks,
} from "../compile/StaticFabProjectChecks";
import { RailDocument } from "../core/RailDocument";
import {
	beginOrdinaryStaticFabIssueRecheck,
	describeOrdinaryStaticFabIssueRecheckResolution,
	ordinaryStaticFabIssueRecheckContextMatchesProject,
	ordinaryStaticFabIssueRecheckPresentation,
	resolveOrdinaryStaticFabIssueRecheck,
} from "./OrdinaryStaticFabIssueRecheck";

const ISSUE = Object.freeze({
	id: "port:PORT_ATTACHMENT:UNRESOLVED",
	code: "PORT_ATTACHMENT",
	domain: "port",
	role: "primary",
	sourceCode: "UNRESOLVED",
	detail: "fixture",
	affectedCount: 1,
	occurrenceOffset: 0,
	locationOffset: 0,
	locationCount: 1,
}) as StaticFabProjectCheckIssue;

const LOCATION = Object.freeze({
	bounds: Object.freeze({ minX: 4, minZ: 8, maxX: 5, maxZ: 9 }),
	kind: "port",
	entityId: 7,
	recordIndex: 2,
	occurrenceIndex: 0,
	detail: "fixture",
	relatedKind: "equipment",
	relatedEntityId: 3,
	relatedRecordIndex: 1,
	token: "P7",
	measuredValue: null,
	requiredValue: null,
	measurementUnit: "none",
	measurementRelation: "none",
}) as StaticFabProjectCheckLocation;

function checks(
	issues: readonly StaticFabProjectCheckIssue[] = Object.freeze([ISSUE]),
	locations: readonly StaticFabProjectCheckLocation[] = Object.freeze([LOCATION]),
): StaticFabProjectChecks {
	return {
		kind: "static-fab-project-checks",
		version: 3,
		sourceRevision: 1,
		sourceChecksum: "checksum",
		sourceSequence: 1,
		sourceNextAdvancedSwitchId: 1,
		sourceNextPortId: 8,
		sourceNextEquipmentGroupId: 4,
		sourceNextOrganizationId: 1,
		railReadinessFingerprint: "rail",
		fingerprint: "checks",
		ready: issues.length === 0,
		summary: {
			railReady: true,
			railIssueCount: 0,
			advancedSwitchCount: 0,
			switchIssueCount: 0,
			portCount: 1,
			portIssueCount: issues.length,
			equipmentGroupCount: 1,
			equipmentIssueCount: 0,
			organizationCount: 0,
			organizationIssueCount: 0,
			hierarchyIssueCount: 0,
			portChecksComplete: true,
			equipmentChecksComplete: true,
			organizationChecksComplete: true,
			blockingIssueCount: issues.length,
			followUpIssueCount: 0,
		},
		issues,
		locationCount: locations.length,
		readOccurrenceDetail: () => "fixture",
		readLocation: (issue, index) => (issue.id === ISSUE.id ? (locations[index] ?? null) : null),
	};
}

describe("ordinary static FAB issue current-source recheck", () => {
	it("captures only an exact current issue location and document identity", () => {
		const document = new RailDocument();
		const context = beginOrdinaryStaticFabIssueRecheck(
			"project-1",
			document,
			"source-1",
			checks(),
			ISSUE,
			0,
		);
		expect(context).toMatchObject({
			projectId: "project-1",
			document,
			originSourceKey: "source-1",
			checksFingerprint: "checks",
			issue: { id: ISSUE.id, code: ISSUE.code, domain: ISSUE.domain },
			location: { kind: "port", entityId: 7, relatedEntityId: 3, token: "P7" },
		});
		expect(
			ordinaryStaticFabIssueRecheckContextMatchesProject(
				context as NonNullable<typeof context>,
				"project-1",
				document,
			),
		).toBe(true);
		expect(
			ordinaryStaticFabIssueRecheckContextMatchesProject(
				context as NonNullable<typeof context>,
				"project-2",
				document,
			),
		).toBe(false);
		expect(
			ordinaryStaticFabIssueRecheckContextMatchesProject(
				context as NonNullable<typeof context>,
				"project-1",
				new RailDocument(),
			),
		).toBe(false);
	});

	it("waits for an explicit source change and exact ready boundary", () => {
		const document = new RailDocument();
		const context = beginOrdinaryStaticFabIssueRecheck(
			"project-1",
			document,
			"source-1",
			checks(),
			ISSUE,
			0,
		);
		const base = {
			projectId: "project-1",
			document,
			currentSourceKey: "source-1",
			guidedBuildActive: false,
			navigatorOpen: false,
			contextualInspectorVisible: false,
			organizationInspectorVisible: false,
			exclusiveCommandActive: false,
			view2d: true,
			readyForRecheck: true,
		};
		expect(ordinaryStaticFabIssueRecheckPresentation(context, base)).toMatchObject({
			state: "waiting",
			disabled: true,
		});
		expect(
			ordinaryStaticFabIssueRecheckPresentation(context, {
				...base,
				currentSourceKey: "source-2",
				readyForRecheck: false,
			}),
		).toMatchObject({ state: "waiting", disabled: true });
		expect(
			ordinaryStaticFabIssueRecheckPresentation(context, {
				...base,
				currentSourceKey: "source-2",
			}),
		).toMatchObject({ state: "ready", disabled: false });
	});

	it.each([
		["guided Build", { guidedBuildActive: true }],
		["the Navigator", { navigatorOpen: true }],
		["a contextual Inspector", { contextualInspectorVisible: true }],
		["the organization Inspector", { organizationInspectorVisible: true }],
		["an exclusive command", { exclusiveCommandActive: true }],
		["3D", { view2d: false }],
	] as const)("stays absent during %s", (_label, override) => {
		const document = new RailDocument();
		const context = beginOrdinaryStaticFabIssueRecheck(
			"project-1",
			document,
			"source-1",
			checks(),
			ISSUE,
			0,
		);
		expect(
			ordinaryStaticFabIssueRecheckPresentation(context, {
				projectId: "project-1",
				document,
				currentSourceKey: "source-2",
				guidedBuildActive: false,
				navigatorOpen: false,
				contextualInspectorVisible: false,
				organizationInspectorVisible: false,
				exclusiveCommandActive: false,
				view2d: true,
				readyForRecheck: true,
				...override,
			}),
		).toBeNull();
	});

	it("distinguishes the same location, a moved occurrence, and a resolved issue", () => {
		const document = new RailDocument();
		const context = beginOrdinaryStaticFabIssueRecheck(
			"project-1",
			document,
			"source-1",
			checks(),
			ISSUE,
			0,
		) as NonNullable<ReturnType<typeof beginOrdinaryStaticFabIssueRecheck>>;
		expect(resolveOrdinaryStaticFabIssueRecheck(context, checks())).toMatchObject({
			state: "same-location",
			locationIndex: 0,
		});
		const reorderedOccurrence = { ...LOCATION, occurrenceIndex: 8 };
		expect(
			resolveOrdinaryStaticFabIssueRecheck(context, checks(undefined, [reorderedOccurrence])),
		).toMatchObject({ state: "same-location", locationIndex: 0 });
		const reorderedRecord = { ...LOCATION, recordIndex: 9, relatedRecordIndex: 12 };
		expect(
			resolveOrdinaryStaticFabIssueRecheck(context, checks(undefined, [reorderedRecord])),
		).toMatchObject({ state: "same-location", locationIndex: 0 });
		const movedLocation = {
			...LOCATION,
			bounds: Object.freeze({ minX: 40, minZ: 80, maxX: 41, maxZ: 81 }),
		};
		expect(
			resolveOrdinaryStaticFabIssueRecheck(context, checks(undefined, [movedLocation])),
		).toMatchObject({ state: "same-issue", locationIndex: 0 });
		expect(resolveOrdinaryStaticFabIssueRecheck(context, checks([], []))).toEqual({
			state: "resolved",
		});
	});

	it("bounds a reordered-location scan and falls back truthfully to the remaining issue", () => {
		const document = new RailDocument();
		const context = beginOrdinaryStaticFabIssueRecheck(
			"project-1",
			document,
			"source-1",
			checks(),
			ISSUE,
			0,
		) as NonNullable<ReturnType<typeof beginOrdinaryStaticFabIssueRecheck>>;
		let reads = 0;
		const manyLocationChecks = checks(
			[{ ...ISSUE, locationCount: 10_000 }],
			Array.from({ length: 10_000 }, (_value, index) => ({
				...LOCATION,
				entityId: 100 + index,
			})),
		);
		const resolution = resolveOrdinaryStaticFabIssueRecheck(context, {
			...manyLocationChecks,
			readLocation: (issue, index) => {
				reads++;
				return manyLocationChecks.readLocation(issue, index);
			},
		});
		expect(resolution).toMatchObject({ state: "same-issue" });
		expect(reads).toBeLessThanOrEqual(1_025);
		expect(describeOrdinaryStaticFabIssueRecheckResolution(resolution, 1, 0)).toBe(
			"선택했던 문제 유형이 현재 검사에도 남아 있습니다 · 전체 1개",
		);
	});

	it("claims a full pass only when project and Rail issue counts are both zero", () => {
		expect(describeOrdinaryStaticFabIssueRecheckResolution({ state: "resolved" }, 0, 0)).toContain(
			"전체 검사 통과",
		);
		expect(describeOrdinaryStaticFabIssueRecheckResolution({ state: "resolved" }, 0, 2)).toContain(
			"다른 검사 2개 남음",
		);
		expect(
			describeOrdinaryStaticFabIssueRecheckResolution(
				{ state: "same-location", issue: ISSUE, locationIndex: 0 },
				1,
				2,
			),
		).toContain("전체 3개");
	});
});
