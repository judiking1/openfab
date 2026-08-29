import { describe, expect, it } from "vitest";
import {
	emptyOperationalConfigurationState,
	reviewOperationalConfiguration,
} from "../core/OperationalConfiguration";
import {
	addOperationalEqCapability,
	addOperationalResidentHomeSlot,
	addOperationalStorageClass,
	addOperationalStoragePolicy,
	removeOperationalEqCapability,
	removeOperationalResidentHomeSlot,
	removeOperationalStoragePolicy,
	replaceOperationalEqGroupQualification,
	replaceOperationalEqPortOverride,
	replaceOperationalResidentHomeSlot,
	replaceOperationalStationCapability,
	replaceOperationalStorageGroup,
	replaceOperationalVehicleProfile,
	summarizeOperationalConfigurationEditor,
} from "./OperationalConfigurationEditorModel";

describe("OperationalConfigurationEditorModel", () => {
	it("edits port and EQ policy by stable authored IDs while clearing review", () => {
		const reviewed = reviewOperationalConfiguration(emptyOperationalConfigurationState(), {
			revision: 4,
			authoredChecksum: "source-a",
		});
		let draft = replaceOperationalStationCapability(reviewed, 9, "PICKUP_ONLY");
		draft = addOperationalEqCapability(draft, "ETCH");
		draft = addOperationalEqCapability(draft, "METROLOGY");
		draft = replaceOperationalEqGroupQualification(draft, 12, [2, 1]);
		draft = replaceOperationalEqPortOverride(draft, 9, [2]);

		expect(draft.review).toBeNull();
		expect(draft.stationCapabilities).toEqual([{ portId: 9, transferCapability: "PICKUP_ONLY" }]);
		expect(draft.eqCapabilities).toEqual([
			{ id: 1, key: "ETCH" },
			{ id: 2, key: "METROLOGY" },
		]);
		expect(draft.eqGroupQualifications).toEqual([{ equipmentGroupId: 12, capabilityIds: [1, 2] }]);
		expect(draft.nextEqCapabilityId).toBe(3);

		const removed = removeOperationalEqCapability(draft, 2);
		expect(removed.eqGroupQualifications[0]?.capabilityIds).toEqual([1]);
		expect(removed.eqPortQualificationOverrides[0]?.capabilityIds).toEqual([]);
		expect(removed.nextEqCapabilityId).toBe(3);
	});

	it("builds storage policy/group and cascades policy removal without rewinding cursors", () => {
		let draft = addOperationalStorageClass(emptyOperationalConfigurationState(), "N2");
		draft = addOperationalStoragePolicy(draft, {
			key: "N2_NEAREST",
			storageClassId: 1,
			priorityRank: 0,
			minimumDwellMilliseconds: 5_000,
		});
		draft = replaceOperationalStorageGroup(
			draft,
			{
				equipmentGroupId: 20,
				policyId: 1,
				capacityUnits: 10,
				initialOccupiedUnits: 2,
				highWaterMarkUnits: 8,
			},
			20,
		);

		expect(draft.storageGroups).toHaveLength(1);
		const removed = removeOperationalStoragePolicy(draft, 1);
		expect(removed.storagePolicies).toEqual([]);
		expect(removed.storageGroups).toEqual([]);
		expect(removed.nextStorageClassId).toBe(2);
		expect(removed.nextStoragePolicyId).toBe(2);
	});

	it("authors resident vehicles only through explicit stable home-port assignments", () => {
		const reviewed = reviewOperationalConfiguration(emptyOperationalConfigurationState(), {
			revision: 4,
			authoredChecksum: "source-a",
		});
		const added = addOperationalResidentHomeSlot(reviewed, "OHT-001", 7);
		const moved = replaceOperationalResidentHomeSlot(added, {
			...added.residentHomeSlots[0],
			anchorPortId: 8,
		});
		const removed = removeOperationalResidentHomeSlot(moved, 1);

		expect(added.residentHomeSlots).toEqual([
			{ id: 1, vehicleId: "OHT-001", anchorPortId: 7, policy: "DEDICATED_HOME_RETURN" },
		]);
		expect(added.nextResidentHomeSlotId).toBe(2);
		expect(added.review).toBeNull();
		expect(moved.residentHomeSlots[0]?.anchorPortId).toBe(8);
		expect(removed.residentHomeSlots).toEqual([]);
		expect(removed.nextResidentHomeSlotId).toBe(2);
	});

	it("distinguishes unapplied content, reviewable content, and exact reviewed state", () => {
		const ports = copyPortEquipmentStateFixture();
		const persisted = completeConfiguration();
		const dirty = replaceOperationalStationCapability(persisted, 1, "PICKUP_ONLY");
		const source = { revision: 8, authoredChecksum: "source-b" };

		expect(summarizeOperationalConfigurationEditor(persisted, dirty, ports, source)).toMatchObject({
			draftDirty: true,
			canAttachReview: false,
			ready: false,
		});
		expect(
			summarizeOperationalConfigurationEditor(persisted, persisted, ports, source),
		).toMatchObject({ draftDirty: false, canAttachReview: true, ready: false });
		const reviewed = reviewOperationalConfiguration(persisted, source);
		expect(
			summarizeOperationalConfigurationEditor(reviewed, reviewed, ports, source),
		).toMatchObject({
			draftDirty: false,
			canAttachReview: false,
			reviewCurrent: true,
			ready: true,
		});
	});
});

function completeConfiguration() {
	let state = replaceOperationalStationCapability(
		emptyOperationalConfigurationState(),
		1,
		"BIDIRECTIONAL",
	);
	state = replaceOperationalStationCapability(state, 2, "BIDIRECTIONAL");
	state = addOperationalEqCapability(state, "PROCESS");
	state = replaceOperationalEqGroupQualification(state, 1, [1]);
	state = addOperationalStorageClass(state, "N2");
	state = addOperationalStoragePolicy(state, {
		key: "N2_POLICY",
		storageClassId: 1,
		priorityRank: 0,
		minimumDwellMilliseconds: 0,
	});
	state = replaceOperationalStorageGroup(
		state,
		{
			equipmentGroupId: 2,
			policyId: 1,
			capacityUnits: 1,
			initialOccupiedUnits: 0,
			highWaterMarkUnits: 1,
		},
		2,
	);
	return replaceOperationalVehicleProfile(state, {
		id: "OHT_TEST_V1",
		version: 1,
		bodyLengthMillimeters: 1_200,
		referenceToFrontMillimeters: 600,
		referenceToRearMillimeters: 600,
		bodyWidthMillimeters: 500,
		lateralSafetyMarginMillimeters: 50,
		frontSafetyMarginMillimeters: 200,
		rearSafetyMarginMillimeters: 200,
		maximumSpeedMillimetersPerSecond: 2_000,
		controlReactionMilliseconds: 100,
		minimumServiceDecelerationMillimetersPerSecondSquared: 1_000,
	});
}

function copyPortEquipmentStateFixture() {
	return {
		nextPortId: 3,
		nextEquipmentGroupId: 3,
		ports: [
			{
				id: 1,
				equipmentGroupId: 1,
				route: { kind: "CARDINAL_CELL" as const, x: 0, z: 0, from: 0 as const, to: 2 as const },
				stationMillimeters: 500,
				side: "RIGHT" as const,
				lateralOffsetMillimeters: 600,
				direction: "WITH_TRAVEL" as const,
				portType: "EQ" as const,
				barcode: "EQ-1",
			},
			{
				id: 2,
				equipmentGroupId: 2,
				route: { kind: "CARDINAL_CELL" as const, x: 1, z: 0, from: 0 as const, to: 2 as const },
				stationMillimeters: 500,
				side: "RIGHT" as const,
				lateralOffsetMillimeters: 600,
				direction: "WITH_TRAVEL" as const,
				portType: "OHB" as const,
				barcode: "OHB-2",
			},
		],
		equipmentGroups: [
			{ id: 1, kind: "EQ" as const, portIds: [1], pitchMillimeters: 1_000, recipe: null },
			{ id: 2, kind: "OHB" as const, portIds: [2], template: "SINGLE" as const },
		],
	};
}
