import { describe, expect, it } from "vitest";
import {
	evaluateGuidedBuildFirstRun,
	type GuidedBuildFirstRunEvidence,
} from "./GuidedBuildFirstRun";
import {
	acknowledgeGuidedBuildNavigation,
	createGuidedBuildPreferences,
	graduateGuidedBuildPractice,
	parseGuidedBuildPreferences,
	recordGuidedBuildEntryChoice,
} from "./GuidedBuildPreferences";

describe("GuidedBuildPreferences", () => {
	it("keeps UI acknowledgement outside authored project data", () => {
		const initial = createGuidedBuildPreferences();
		const guided = recordGuidedBuildEntryChoice(initial, "guided");
		const oriented = acknowledgeGuidedBuildNavigation(guided);

		expect(initial).toEqual({
			schemaVersion: 2,
			lastEntryChoice: null,
			navigationAcknowledged: false,
			graduatedProjectId: null,
		});
		expect(oriented).toEqual({
			schemaVersion: 2,
			lastEntryChoice: "guided",
			navigationAcknowledged: true,
			graduatedProjectId: null,
		});
		expect(Object.isFrozen(oriented)).toBe(true);
	});

	it("rejects unknown or incomplete preference records", () => {
		expect(parseGuidedBuildPreferences({ schemaVersion: 3 })).toBeNull();
		expect(
			parseGuidedBuildPreferences({
				schemaVersion: 2,
				lastEntryChoice: "campaign",
				navigationAcknowledged: false,
				graduatedProjectId: null,
			}),
		).toBeNull();
	});

	it("migrates the pre-graduation preference without reopening onboarding", () => {
		expect(
			parseGuidedBuildPreferences({
				schemaVersion: 1,
				lastEntryChoice: "dismissed",
				navigationAcknowledged: true,
			}),
		).toEqual({
			schemaVersion: 2,
			lastEntryChoice: "dismissed",
			navigationAcknowledged: true,
			graduatedProjectId: null,
		});
	});

	it("binds practice graduation to one explicit semantic FAB project", () => {
		const graduated = graduateGuidedBuildPractice(
			acknowledgeGuidedBuildNavigation(createGuidedBuildPreferences()),
			" project-guided ",
		);

		expect(graduated.graduatedProjectId).toBe("project-guided");
		expect(() => graduateGuidedBuildPractice(graduated, " ")).toThrow(TypeError);
	});
});

describe("evaluateGuidedBuildFirstRun", () => {
	it("opens only for the first safe empty session", () => {
		expect(evaluateGuidedBuildFirstRun(evidence())).toEqual({
			action: "open",
			reason: "FIRST_SAFE_EMPTY_SESSION",
		});
	});

	it.each([
		["recovery", { hasRecoveryProject: true }, "RECOVERY_AVAILABLE"],
		["recent project", { recentProjectCount: 1 }, "RETURNING_PROJECTS_AVAILABLE"],
		["authored content", { authoredRecordCount: 1 }, "AUTHORED_PROJECT_ACTIVE"],
		["blocking editor", { blockingSurfaceOpen: true }, "BLOCKING_SURFACE_ACTIVE"],
		["scale acceptance", { scaleAcceptanceActive: true }, "SCALE_ACCEPTANCE_ACTIVE"],
	] as const)("suppresses automatic entry for %s", (_label, overrides, reason) => {
		expect(evaluateGuidedBuildFirstRun(evidence(overrides))).toEqual({
			action: "suppress",
			reason,
		});
	});

	it("never reopens after any explicit entry decision", () => {
		const preferences = recordGuidedBuildEntryChoice(createGuidedBuildPreferences(), "blank");

		expect(evaluateGuidedBuildFirstRun(evidence({ preferences }))).toEqual({
			action: "suppress",
			reason: "ENTRY_ALREADY_CHOSEN",
		});
	});

	it.each([
		["preferences", { preferenceLoadStatus: "loading" }, "PREFERENCES_LOADING"],
		["startup", { startupReady: false }, "STARTUP_PENDING"],
		["metadata", { recentLookupComplete: false }, "PROJECT_METADATA_PENDING"],
		["project operation", { projectOperationIdle: false }, "PROJECT_OPERATION_ACTIVE"],
		["model sync", { modelSyncPending: true }, "MODEL_SYNC_PENDING"],
	] as const)("waits for %s instead of consuming the session", (_label, overrides, reason) => {
		expect(evaluateGuidedBuildFirstRun(evidence(overrides))).toEqual({ action: "wait", reason });
	});

	it("suppresses auto-entry when the platform preference port is unavailable", () => {
		expect(evaluateGuidedBuildFirstRun(evidence({ preferenceLoadStatus: "unavailable" }))).toEqual({
			action: "suppress",
			reason: "PREFERENCES_UNAVAILABLE",
		});
	});
});

function evidence(
	overrides: Partial<GuidedBuildFirstRunEvidence> = {},
): GuidedBuildFirstRunEvidence {
	return {
		preferenceLoadStatus: "ready",
		preferences: null,
		alreadyConsideredThisSession: false,
		startupReady: true,
		recentLookupComplete: true,
		recoveryLookupComplete: true,
		recentProjectCount: 0,
		hasRecoveryProject: false,
		authoredRecordCount: 0,
		projectOperationIdle: true,
		modelSyncPending: false,
		blockingSurfaceOpen: false,
		scaleAcceptanceActive: false,
		...overrides,
	};
}
