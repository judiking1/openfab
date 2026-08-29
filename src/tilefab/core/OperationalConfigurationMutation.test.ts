import { describe, expect, it } from "vitest";
import {
	checksumOperationalConfiguration,
	copyOperationalConfigurationState,
	emptyOperationalConfigurationState,
	reviewOperationalConfiguration,
} from "./OperationalConfiguration";
import {
	applyOperationalConfigurationPatch,
	operationalConfigurationPatchTransitionFingerprint,
	planOperationalConfigurationReplacement,
	replayOperationalConfigurationPatch,
	reverseOperationalConfigurationPatch,
} from "./OperationalConfigurationMutation";

describe("OperationalConfigurationMutation", () => {
	it("plans one compact semantic delta, advances revision, and clears stale review", () => {
		const source = reviewOperationalConfiguration(emptyOperationalConfigurationState(), {
			revision: 9,
			authoredChecksum: "authored-source-a",
		});
		const replacement = {
			...source,
			revision: 999,
			stationCapabilities: [{ portId: 7, transferCapability: "PICKUP_ONLY" as const }],
		};
		const plan = planOperationalConfigurationReplacement(source, replacement, 12, 44);

		expect(plan?.baseRailRevision).toBe(12);
		expect(plan?.basePatchSequence).toBe(44);
		expect(plan?.patch.stationCapabilityChanges).toEqual([
			{
				id: 7,
				before: null,
				after: { portId: 7, transferCapability: "PICKUP_ONLY" },
			},
		]);
		expect(plan?.patch.configurationRevision).toBe(1);
		expect(plan?.patch.reviewBefore).toEqual(source.review);
		expect(plan?.patch.reviewAfter).toBeNull();

		const applied = applyOperationalConfigurationPatch(source, requiredPlan(plan).patch);
		expect(applied.revision).toBe(1);
		expect(applied.stationCapabilities).toEqual(replacement.stationCapabilities);
		expect(applied.review).toBeNull();
	});

	it("undoes and replays semantic records while revisions and definition cursors remain monotonic", () => {
		const source = emptyOperationalConfigurationState();
		const replacement = copyOperationalConfigurationState({
			...source,
			nextEqCapabilityId: 2,
			nextResidentHomeSlotId: 2,
			eqCapabilities: [{ id: 1, key: "PROCESS" }],
			residentHomeSlots: [
				{ id: 1, vehicleId: "OHT-001", anchorPortId: 7, policy: "DEDICATED_HOME_RETURN" },
			],
		});
		const forward = requiredPlan(
			planOperationalConfigurationReplacement(source, replacement, 0, 0),
		).patch;
		const applied = applyOperationalConfigurationPatch(source, forward);
		const reverse = reverseOperationalConfigurationPatch(forward, applied);
		const undone = applyOperationalConfigurationPatch(applied, reverse);
		const replay = replayOperationalConfigurationPatch(forward, undone);
		const redone = applyOperationalConfigurationPatch(undone, replay);

		expect(applied.revision).toBe(1);
		expect(undone.revision).toBe(2);
		expect(redone.revision).toBe(3);
		expect(undone.eqCapabilities).toEqual([]);
		expect(redone.eqCapabilities).toEqual([{ id: 1, key: "PROCESS" }]);
		expect(undone.residentHomeSlots).toEqual([]);
		expect(redone.residentHomeSlots).toEqual(replacement.residentHomeSlots);
		expect(applied.nextEqCapabilityId).toBe(2);
		expect(undone.nextEqCapabilityId).toBe(2);
		expect(redone.nextEqCapabilityId).toBe(2);
		expect(applied.nextResidentHomeSlotId).toBe(2);
		expect(undone.nextResidentHomeSlotId).toBe(2);
		expect(redone.nextResidentHomeSlotId).toBe(2);
		expect(operationalConfigurationPatchTransitionFingerprint(reverse)).toBe(
			operationalConfigurationPatchTransitionFingerprint(forward, true),
		);
		expect(operationalConfigurationPatchTransitionFingerprint(replay)).toBe(
			operationalConfigurationPatchTransitionFingerprint(forward),
		);
	});

	it("makes review-only edits exactly undoable and replayable without changing content identity", () => {
		const source = emptyOperationalConfigurationState();
		const reviewed = reviewOperationalConfiguration(source, {
			revision: 0,
			authoredChecksum: "empty-authored-source",
		});
		const forward = requiredPlan(
			planOperationalConfigurationReplacement(source, reviewed, 0, 0),
		).patch;
		const applied = applyOperationalConfigurationPatch(source, forward);
		const reverse = reverseOperationalConfigurationPatch(forward, applied);
		const undone = applyOperationalConfigurationPatch(applied, reverse);
		const replay = replayOperationalConfigurationPatch(forward, undone);
		const redone = applyOperationalConfigurationPatch(undone, replay);

		expect(applied.revision).toBe(0);
		expect(undone.review).toBeNull();
		expect(redone.review).toEqual(reviewed.review);
		expect(checksumOperationalConfiguration(redone)).toBe(checksumOperationalConfiguration(source));
		expect(operationalConfigurationPatchTransitionFingerprint(reverse)).toBe(
			operationalConfigurationPatchTransitionFingerprint(forward, true),
		);
	});

	it("rejects stale before-values, non-monotonic cursors, no-op patches, and cursor-only edits", () => {
		const source = emptyOperationalConfigurationState();
		const forward = requiredPlan(
			planOperationalConfigurationReplacement(
				source,
				copyOperationalConfigurationState({
					...source,
					stationCapabilities: [{ portId: 4, transferCapability: "BIDIRECTIONAL" }],
				}),
				0,
				0,
			),
		).patch;

		expect(() =>
			applyOperationalConfigurationPatch(
				copyOperationalConfigurationState({
					...source,
					stationCapabilities: [{ portId: 4, transferCapability: "DROPOFF_ONLY" }],
				}),
				forward,
			),
		).toThrow("before-value mismatch");
		expect(() =>
			applyOperationalConfigurationPatch(source, {
				...forward,
				nextEqCapabilityIdAfter: 0,
			}),
		).toThrow("cannot move backwards");
		expect(() =>
			applyOperationalConfigurationPatch(source, {
				...forward,
				stationCapabilityChanges: [],
				configurationRevision: 0,
			}),
		).toThrow("contains no change");
		expect(() =>
			planOperationalConfigurationReplacement(
				source,
				copyOperationalConfigurationState({ ...source, nextEqCapabilityId: 2 }),
				0,
				0,
			),
		).toThrow("cannot advance without a semantic edit");
		expect(planOperationalConfigurationReplacement(source, source, 0, 0)).toBeNull();
	});
});

function requiredPlan<T>(value: T | null): T {
	if (value === null) throw new Error("Expected a non-empty operational plan fixture.");
	return value;
}
