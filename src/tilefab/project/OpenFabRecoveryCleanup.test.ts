import { describe, expect, it } from "vitest";
import type { OpenFabRecoveryProjectSummary } from "./OpenFabProjectPorts";
import { planOpenFabRecoveryCleanup, recoveryCleanupPlansEqual } from "./OpenFabRecoveryCleanup";

describe("OpenFabRecoveryCleanup", () => {
	it("retains the newest projects plus explicitly protected older projects", () => {
		const summaries = Array.from({ length: 6 }, (_, index) => recoverySummary(index));

		const plan = planOpenFabRecoveryCleanup(summaries, {
			retainedProjectCount: 2,
			protectedProjectIds: ["recovery-1", "recovery-1"],
		});

		expect(plan).toMatchObject({
			retainedProjectCount: 2,
			protectedProjectIds: ["recovery-1"],
			totalCount: 6,
			retainedCount: 3,
			removableCount: 3,
			totalJsonCharacters: 615,
			removableJsonCharacters: 305,
		});
		expect(plan.candidates.map(({ projectId }) => projectId)).toEqual([
			"recovery-3",
			"recovery-2",
			"recovery-0",
		]);
	});

	it("produces an empty plan when the inventory fits within the retention floor", () => {
		const plan = planOpenFabRecoveryCleanup([recoverySummary(0)], {
			retainedProjectCount: 50,
		});

		expect(plan).toMatchObject({
			totalCount: 1,
			retainedCount: 1,
			removableCount: 0,
			removableJsonCharacters: 0,
		});
		expect(plan.candidates).toEqual([]);
	});

	it("rejects unsafe policies and detects candidate snapshot changes", () => {
		expect(() => planOpenFabRecoveryCleanup([], { retainedProjectCount: 0 })).toThrow(
			"retain at least one",
		);
		expect(() =>
			planOpenFabRecoveryCleanup([recoverySummary(0)], {
				retainedProjectCount: 1,
				protectedProjectIds: [""],
			}),
		).toThrow("non-empty strings");
		const left = planOpenFabRecoveryCleanup(
			[recoverySummary(0), recoverySummary(1), recoverySummary(2)],
			{ retainedProjectCount: 1 },
		);
		const right = planOpenFabRecoveryCleanup(
			[recoverySummary(0), recoverySummary(1), { ...recoverySummary(2), jsonCharacters: 999 }],
			{ retainedProjectCount: 1 },
		);
		expect(recoveryCleanupPlansEqual(left, left)).toBe(true);
		expect(recoveryCleanupPlansEqual(left, right)).toBe(false);
	});
});

function recoverySummary(index: number): OpenFabRecoveryProjectSummary {
	return Object.freeze({
		projectId: `recovery-${index}`,
		name: `Recovery ${index}`,
		updatedAt: `2026-07-18T00:00:0${index}.000Z`,
		authoredChecksum: `checksum-${index}`,
		jsonCharacters: 100 + index,
	});
}
