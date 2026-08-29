import { describe, expect, it } from "vitest";
import {
	isOpenFabProjectDirty,
	shouldProtectOpenFabProjectTransition,
	shouldScheduleOpenFabProjectRecovery,
} from "./OpenFabProjectSession";

describe("OpenFab project session policy", () => {
	it("treats unsaved, migrated, and checksum-diverged projects as dirty", () => {
		expect(
			isOpenFabProjectDirty(
				{
					savedChecksum: "A",
					savedOperationalConfigurationFingerprint: "O1",
					migrated: false,
					needsSave: false,
				},
				"A",
				"O1",
			),
		).toBe(false);
		expect(
			isOpenFabProjectDirty(
				{
					savedChecksum: "A",
					savedOperationalConfigurationFingerprint: "O1",
					migrated: false,
					needsSave: true,
				},
				"A",
				"O1",
			),
		).toBe(true);
		expect(
			isOpenFabProjectDirty(
				{
					savedChecksum: "A",
					savedOperationalConfigurationFingerprint: "O1",
					migrated: true,
					needsSave: false,
				},
				"A",
				"O1",
			),
		).toBe(true);
		expect(
			isOpenFabProjectDirty(
				{
					savedChecksum: "A",
					savedOperationalConfigurationFingerprint: "O1",
					migrated: false,
					needsSave: false,
				},
				"B",
				"O1",
			),
		).toBe(true);
		expect(
			isOpenFabProjectDirty(
				{
					savedChecksum: "A",
					savedOperationalConfigurationFingerprint: "O1",
					migrated: false,
					needsSave: false,
				},
				"A",
				"O2",
			),
		).toBe(true);
	});

	it("guards meaningful work but lets an untouched unsaved blank project transition", () => {
		const blank = {
			dirty: true,
			mustPreserve: false,
			authoredRecords: 0,
			canUndo: false,
			canRedo: false,
		};
		expect(shouldProtectOpenFabProjectTransition(blank)).toBe(false);
		expect(shouldProtectOpenFabProjectTransition({ ...blank, authoredRecords: 1 })).toBe(true);
		expect(shouldProtectOpenFabProjectTransition({ ...blank, canUndo: true })).toBe(true);
		expect(shouldProtectOpenFabProjectTransition({ ...blank, canRedo: true })).toBe(true);
		expect(shouldProtectOpenFabProjectTransition({ ...blank, mustPreserve: true })).toBe(true);
		expect(
			shouldProtectOpenFabProjectTransition({ ...blank, dirty: false, authoredRecords: 1 }),
		).toBe(false);
	});

	it("never overwrites a recovery offer before the user resolves it", () => {
		const readyDirtySession = {
			dirty: true,
			scaleProbeActive: false,
			startupReady: true,
			modelSyncPending: false,
			recoveryLookupComplete: true,
			projectId: "project-a",
			recoveryOfferProjectId: null,
			operationIdle: true,
		};

		expect(shouldScheduleOpenFabProjectRecovery(readyDirtySession)).toBe(true);
		expect(
			shouldScheduleOpenFabProjectRecovery({
				...readyDirtySession,
				recoveryLookupComplete: false,
			}),
		).toBe(false);
		expect(
			shouldScheduleOpenFabProjectRecovery({
				...readyDirtySession,
				recoveryOfferProjectId: "project-a",
			}),
		).toBe(false);
		expect(
			shouldScheduleOpenFabProjectRecovery({
				...readyDirtySession,
				recoveryOfferProjectId: "project-b",
			}),
		).toBe(true);
		expect(shouldScheduleOpenFabProjectRecovery({ ...readyDirtySession, dirty: false })).toBe(
			false,
		);
		expect(
			shouldScheduleOpenFabProjectRecovery({ ...readyDirtySession, operationIdle: false }),
		).toBe(false);
	});
});
