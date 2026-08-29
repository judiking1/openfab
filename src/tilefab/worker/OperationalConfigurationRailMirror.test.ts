import { describe, expect, it } from "vitest";
import {
	checksumOperationalConfigurationState,
	copyOperationalConfigurationState,
	emptyOperationalConfigurationState,
} from "../core/OperationalConfiguration";
import { RailDocument, type RailPatchEvent } from "../core/RailDocument";
import { captureRailMirrorSnapshot } from "./RailMirrorChecksum";
import { RailMirrorWorkerRuntime } from "./RailMirrorWorkerRuntime";
import { RailPatchMirror } from "./RailPatchMirror";
import { decodeRailPatchSoA, encodeRailPatchEvent } from "./railMirrorProtocol";

describe("operational configuration rail mirror", () => {
	it("synchronizes, applies, undoes, and redoes one typed operational delta", () => {
		const document = new RailDocument();
		const runtime = new RailMirrorWorkerRuntime();
		const snapshot = captureRailMirrorSnapshot(document.map, 0).snapshot;
		expect(
			runtime.handle({
				type: "SYNC_RAIL",
				epoch: 1,
				snapshot,
				operationalConfiguration: document.operationalConfiguration,
				historyLedger: document.captureRailMirrorHistoryLedger(),
			}),
		).toMatchObject({
			type: "RAIL_SYNCED",
			operationalConfigurationRevision: 0,
			operationalConfigurationFingerprint: checksumOperationalConfigurationState(
				emptyOperationalConfigurationState(),
			),
		});

		const replacement = copyOperationalConfigurationState({
			...document.operationalConfiguration,
			nextResidentHomeSlotId: 2,
			stationCapabilities: [{ portId: 5, transferCapability: "BIDIRECTIONAL" }],
			residentHomeSlots: [
				{ id: 1, vehicleId: "OHT-001", anchorPortId: 5, policy: "DEDICATED_HOME_RETURN" },
			],
		});
		const forward = captureEvent(document, () => {
			const plan = document.planOperationalConfigurationReplacement(replacement);
			return plan !== null && document.commitOperationalConfiguration(plan);
		});
		const forwardWire = encodeRailPatchEvent(forward).patch;
		expect(decodeRailPatchSoA(forwardWire).operationalConfigurationPatch).toEqual(
			forward.operationalConfigurationPatch,
		);
		expect(
			runtime.handle({ type: "APPLY_RAIL_PATCH", epoch: 1, patch: forwardWire }),
		).toMatchObject({
			type: "RAIL_PATCH_APPLIED",
			sequence: 1,
			revision: 0,
			operationalConfigurationRevision: 1,
			operationalConfigurationFingerprint: checksumOperationalConfigurationState(
				document.operationalConfiguration,
			),
		});

		const undo = captureEvent(document, () => document.undo());
		expect(
			runtime.handle({
				type: "APPLY_RAIL_PATCH",
				epoch: 1,
				patch: encodeRailPatchEvent(undo).patch,
			}),
		).toMatchObject({
			type: "RAIL_PATCH_APPLIED",
			sequence: 2,
			operationalConfigurationRevision: 2,
		});

		const redo = captureEvent(document, () => document.redo());
		expect(
			runtime.handle({
				type: "APPLY_RAIL_PATCH",
				epoch: 1,
				patch: encodeRailPatchEvent(redo).patch,
			}),
		).toMatchObject({
			type: "RAIL_PATCH_APPLIED",
			sequence: 3,
			operationalConfigurationRevision: 3,
			operationalConfigurationFingerprint: checksumOperationalConfigurationState(
				document.operationalConfiguration,
			),
		});

		const clear = captureEvent(document, () => document.clear());
		expect(
			runtime.handle({
				type: "APPLY_RAIL_PATCH",
				epoch: 1,
				patch: encodeRailPatchEvent(clear).patch,
			}),
		).toMatchObject({
			type: "RAIL_PATCH_APPLIED",
			sequence: 4,
			operationalConfigurationRevision: 4,
		});
		expect(document.operationalConfiguration.stationCapabilities).toEqual([]);
		expect(document.operationalConfiguration.residentHomeSlots).toEqual([]);
		const undoClear = captureEvent(document, () => document.undo());
		expect(
			runtime.handle({
				type: "APPLY_RAIL_PATCH",
				epoch: 1,
				patch: encodeRailPatchEvent(undoClear).patch,
			}),
		).toMatchObject({
			type: "RAIL_PATCH_APPLIED",
			sequence: 5,
			operationalConfigurationRevision: 5,
		});
		expect(document.operationalConfiguration.stationCapabilities).toEqual([
			{ portId: 5, transferCapability: "BIDIRECTIONAL" },
		]);
		expect(document.operationalConfiguration.residentHomeSlots).toEqual(
			replacement.residentHomeSlots,
		);
	});

	it("rejects an operational delta hidden under an unrelated authored patch kind", () => {
		const document = new RailDocument();
		const mirror = new RailPatchMirror();
		mirror.sync(
			captureRailMirrorSnapshot(document.map, 0).snapshot,
			document.captureRailMirrorHistoryLedger(),
			document.operationalConfiguration,
		);
		const replacement = copyOperationalConfigurationState({
			...document.operationalConfiguration,
			stationCapabilities: [{ portId: 2, transferCapability: "PICKUP_ONLY" }],
		});
		const event = captureEvent(document, () => {
			const plan = document.planOperationalConfigurationReplacement(replacement);
			return plan !== null && document.commitOperationalConfiguration(plan);
		});
		const forged: RailPatchEvent = { ...event, kind: "edit" };

		expect(() => mirror.applyPatch(forged)).toThrow(
			"cannot carry an operational configuration delta",
		);
		expect(mirror.state.sequence).toBe(0);
		expect(mirror.state.operationalConfigurationRevision).toBe(0);
	});
});

function captureEvent(document: RailDocument, commit: () => boolean): RailPatchEvent {
	let event: RailPatchEvent | null = null;
	const unsubscribe = document.subscribe((candidate) => {
		event = candidate;
	});
	const committed = commit();
	unsubscribe();
	if (!committed || event === null) throw new Error("Failed to capture operational mirror event.");
	return event;
}
