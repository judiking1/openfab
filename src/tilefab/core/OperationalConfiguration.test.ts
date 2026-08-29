import { describe, expect, it } from "vitest";
import { copyPortEquipmentState, type PortEquipmentState } from "./EquipmentGroup";
import {
	checksumOperationalConfiguration,
	checksumOperationalConfigurationState,
	collectOperationalConfigurationReadinessIssues,
	copyOperationalConfigurationState,
	emptyOperationalConfigurationState,
	invalidateOperationalConfigurationReview,
	type OperationalConfigurationState,
	operationalConfigurationIsReady,
	operationalConfigurationStateError,
	reviewOperationalConfiguration,
} from "./OperationalConfiguration";
import type { PortRecord, PortType } from "./PortRecord";
import { DIR_E, DIR_W } from "./railShape";

const SOURCE = Object.freeze({ revision: 7, authoredChecksum: "source-checksum-v1" });

describe("OperationalConfiguration", () => {
	it("keeps a new project explicitly unresolved instead of manufacturing policy defaults", () => {
		const state = emptyOperationalConfigurationState();
		const issues = collectOperationalConfigurationReadinessIssues(
			state,
			mixedPortEquipment(),
			SOURCE,
		);

		expect(state.vehicleProfile).toBeNull();
		expect(state.stationCapabilities).toEqual([]);
		expect(issues.map((issue) => issue.code)).toEqual([
			"STATION_CAPABILITY_MISSING",
			"EQ_GROUP_QUALIFICATION_MISSING",
			"STORAGE_GROUP_CONFIGURATION_MISSING",
			"VEHICLE_PROFILE_MISSING",
			"REVIEW_REQUIRED",
		]);
		expect(issues[0]?.portIds).toEqual([1, 2, 3, 4, 5]);
		expect(issues[1]?.equipmentGroupIds).toEqual([1]);
		expect(issues[2]?.equipmentGroupIds).toEqual([2, 3]);
		expect(operationalConfigurationIsReady(state, mixedPortEquipment(), SOURCE)).toBe(false);
	});

	it("canonicalizes record and reference order into one immutable fingerprint", () => {
		const reordered = completeConfiguration({
			stationCapabilities: [...completeConfiguration().stationCapabilities].reverse(),
			eqCapabilities: [
				{ id: 2, key: "METROLOGY" },
				{ id: 1, key: "PROCESS" },
			],
			nextEqCapabilityId: 3,
			eqGroupQualifications: [{ equipmentGroupId: 1, capabilityIds: [2, 1] }],
			eqPortQualificationOverrides: [{ portId: 2, capabilityIds: [2, 1] }],
			storageGroups: [...completeConfiguration().storageGroups].reverse(),
			nextResidentHomeSlotId: 3,
			residentHomeSlots: [
				{ id: 2, vehicleId: "OHT-002", anchorPortId: 5, policy: "DEDICATED_HOME_RETURN" },
				{ id: 1, vehicleId: "OHT-001", anchorPortId: 4, policy: "DEDICATED_HOME_RETURN" },
			],
		});
		const canonical = copyOperationalConfigurationState(reordered);
		const equivalent = copyOperationalConfigurationState({
			...reordered,
			stationCapabilities: completeConfiguration().stationCapabilities,
			eqCapabilities: [
				{ id: 1, key: "PROCESS" },
				{ id: 2, key: "METROLOGY" },
			],
			eqGroupQualifications: [{ equipmentGroupId: 1, capabilityIds: [1, 2] }],
			eqPortQualificationOverrides: [{ portId: 2, capabilityIds: [1, 2] }],
			storageGroups: completeConfiguration().storageGroups,
			residentHomeSlots: [...reordered.residentHomeSlots].reverse(),
		});

		expect(canonical.stationCapabilities.map((record) => record.portId)).toEqual([1, 2, 3, 4, 5]);
		expect(canonical.eqCapabilities.map((record) => record.id)).toEqual([1, 2]);
		expect(canonical.eqGroupQualifications[0]?.capabilityIds).toEqual([1, 2]);
		expect(canonical.residentHomeSlots.map((record) => record.id)).toEqual([1, 2]);
		expect(checksumOperationalConfiguration(canonical)).toBe(
			checksumOperationalConfiguration(equivalent),
		);
		expect(Object.isFrozen(canonical)).toBe(true);
		expect(Object.isFrozen(canonical.stationCapabilities)).toBe(true);
		expect(Object.isFrozen(canonical.storageGroups[0])).toBe(true);
		expect(Object.isFrozen(canonical.residentHomeSlots[0])).toBe(true);
	});

	it("requires unique explicit resident vehicle and home-port identities and reports foreign anchors", () => {
		const resident = completeConfiguration({
			nextResidentHomeSlotId: 2,
			residentHomeSlots: [
				{ id: 1, vehicleId: "OHT-001", anchorPortId: 4, policy: "DEDICATED_HOME_RETURN" },
			],
		});
		expect(operationalConfigurationStateError(resident)).toBeNull();
		expect(
			operationalConfigurationStateError({
				...resident,
				nextResidentHomeSlotId: 3,
				residentHomeSlots: [
					...resident.residentHomeSlots,
					{ id: 2, vehicleId: "OHT-001", anchorPortId: 5, policy: "DEDICATED_HOME_RETURN" },
				],
			}),
		).toContain("vehicle ID is duplicated");
		expect(
			collectOperationalConfigurationReadinessIssues(
				copyOperationalConfigurationState({
					...resident,
					residentHomeSlots: [
						{ id: 1, vehicleId: "OHT-001", anchorPortId: 99, policy: "DEDICATED_HOME_RETURN" },
					],
				}),
				mixedPortEquipment(),
				SOURCE,
			).map((issue) => issue.code),
		).toContain("RESIDENT_HOME_SLOT_FOREIGN");
	});

	it("rejects intrinsic duplicate, reference, cursor, and vehicle faults", () => {
		const source = completeConfiguration();
		expect(
			operationalConfigurationStateError({
				...source,
				stationCapabilities: [...source.stationCapabilities, source.stationCapabilities[0]],
			}),
		).toContain("repeats port 1");
		expect(
			operationalConfigurationStateError({
				...source,
				eqGroupQualifications: [{ equipmentGroupId: 1, capabilityIds: [99] }],
			}),
		).toContain("unknown");
		expect(operationalConfigurationStateError({ ...source, nextStoragePolicyId: 1 })).toContain(
			"cursor must exceed",
		);
		expect(
			operationalConfigurationStateError({
				...source,
				vehicleProfile: { ...source.vehicleProfile, referenceToRearMillimeters: 599 },
			}),
		).toContain("must sum to body length");
	});

	it("binds review to exact configuration content and authored source identity", () => {
		const reviewed = reviewOperationalConfiguration(completeConfiguration(), SOURCE);

		expect(reviewed.review).toEqual({
			sourceRevision: 7,
			sourceAuthoredChecksum: "source-checksum-v1",
			configurationFingerprint: checksumOperationalConfiguration(reviewed),
		});
		expect(
			collectOperationalConfigurationReadinessIssues(reviewed, mixedPortEquipment(), SOURCE),
		).toEqual([]);
		expect(operationalConfigurationIsReady(reviewed, mixedPortEquipment(), SOURCE)).toBe(true);
		expect(
			collectOperationalConfigurationReadinessIssues(reviewed, mixedPortEquipment(), {
				revision: 8,
				authoredChecksum: SOURCE.authoredChecksum,
			}).map((issue) => issue.code),
		).toEqual(["REVIEW_SOURCE_MISMATCH"]);
	});

	it("rejects a retained review after configuration content changes", () => {
		const reviewed = reviewOperationalConfiguration(completeConfiguration(), SOURCE);
		const mutated = {
			...reviewed,
			revision: reviewed.revision + 1,
			stationCapabilities: reviewed.stationCapabilities.map((record) =>
				record.portId === 1 ? { ...record, transferCapability: "PICKUP_ONLY" as const } : record,
			),
		};

		expect(operationalConfigurationStateError(mutated)).toContain(
			"review does not match current configuration content",
		);
		expect(() => copyOperationalConfigurationState(mutated)).toThrow(
			"review does not match current configuration content",
		);
	});

	it("invalidates review explicitly without changing configuration content revision", () => {
		const reviewed = reviewOperationalConfiguration(completeConfiguration(), SOURCE);
		const invalidated = invalidateOperationalConfigurationReview(reviewed);

		expect(invalidated.review).toBeNull();
		expect(invalidated.revision).toBe(reviewed.revision);
		expect(checksumOperationalConfiguration(invalidated)).toBe(
			checksumOperationalConfiguration(reviewed),
		);
		expect(checksumOperationalConfigurationState(invalidated)).not.toBe(
			checksumOperationalConfigurationState(reviewed),
		);
	});

	it("reports foreign and wrong-kind physical references while retaining a valid draft", () => {
		const draft = copyOperationalConfigurationState({
			...completeConfiguration(),
			stationCapabilities: [
				...completeConfiguration().stationCapabilities,
				{ portId: 99, transferCapability: "BIDIRECTIONAL" },
			],
			eqGroupQualifications: [{ equipmentGroupId: 2, capabilityIds: [1] }],
			eqPortQualificationOverrides: [{ portId: 3, capabilityIds: [1] }],
			storageGroups: [
				{ ...completeConfiguration().storageGroups[0], equipmentGroupId: 1 },
				completeConfiguration().storageGroups[1],
			],
		});
		const issues = collectOperationalConfigurationReadinessIssues(
			draft,
			mixedPortEquipment(),
			SOURCE,
		);

		expect(issues.map((issue) => issue.code)).toEqual([
			"STATION_CAPABILITY_FOREIGN",
			"EQ_GROUP_QUALIFICATION_MISSING",
			"EQ_GROUP_QUALIFICATION_FOREIGN_OR_WRONG_KIND",
			"EQ_PORT_OVERRIDE_FOREIGN_OR_WRONG_KIND",
			"STORAGE_GROUP_CONFIGURATION_MISSING",
			"STORAGE_GROUP_CONFIGURATION_FOREIGN_OR_WRONG_KIND",
			"REVIEW_REQUIRED",
		]);
	});
});

function completeConfiguration(
	override: Partial<OperationalConfigurationState> = {},
): OperationalConfigurationState {
	return {
		schemaVersion: 2,
		revision: 3,
		nextEqCapabilityId: 2,
		nextStorageClassId: 2,
		nextStoragePolicyId: 2,
		nextResidentHomeSlotId: 1,
		stationCapabilities: [
			{ portId: 1, transferCapability: "BIDIRECTIONAL" },
			{ portId: 2, transferCapability: "DROPOFF_ONLY" },
			{ portId: 3, transferCapability: "PICKUP_ONLY" },
			{ portId: 4, transferCapability: "BIDIRECTIONAL" },
			{ portId: 5, transferCapability: "BIDIRECTIONAL" },
		],
		eqCapabilities: [{ id: 1, key: "PROCESS" }],
		eqGroupQualifications: [{ equipmentGroupId: 1, capabilityIds: [1] }],
		eqPortQualificationOverrides: [{ portId: 2, capabilityIds: [] }],
		storageClasses: [{ id: 1, key: "BUFFER" }],
		storagePolicies: [
			{
				id: 1,
				key: "BUFFER_FIFO",
				storageClassId: 1,
				priorityRank: 0,
				minimumDwellMilliseconds: 0,
			},
		],
		storageGroups: [
			{
				equipmentGroupId: 2,
				policyId: 1,
				capacityUnits: 2,
				initialOccupiedUnits: 0,
				highWaterMarkUnits: 2,
			},
			{
				equipmentGroupId: 3,
				policyId: 1,
				capacityUnits: 8,
				initialOccupiedUnits: 1,
				highWaterMarkUnits: 6,
			},
		],
		residentHomeSlots: [],
		vehicleProfile: {
			id: "OPENFAB_TEST_OHT_V1",
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
		},
		review: null,
		...override,
	};
}

function mixedPortEquipment(): PortEquipmentState {
	return copyPortEquipmentState({
		nextPortId: 6,
		nextEquipmentGroupId: 4,
		ports: [
			port(1, 1, "EQ", 0),
			port(2, 1, "EQ", 1),
			port(3, 2, "OHB", 2),
			port(4, 3, "STK", 3),
			port(5, 3, "STK", 4),
		],
		equipmentGroups: [
			{
				id: 1,
				kind: "EQ",
				portIds: [1, 2],
				pitchMillimeters: 1_000,
				recipe: null,
			},
			{ id: 2, kind: "OHB", template: "SINGLE", portIds: [3] },
			{ id: 3, kind: "STK", template: "FLEX", portIds: [4, 5] },
		],
	});
}

function port(id: number, equipmentGroupId: number, portType: PortType, x: number): PortRecord {
	return {
		id,
		equipmentGroupId,
		route: { kind: "CARDINAL_CELL", x, z: 0, from: DIR_W, to: DIR_E },
		stationMillimeters: 500,
		side: "CENTER",
		lateralOffsetMillimeters: 0,
		direction: "WITH_TRAVEL",
		portType,
		barcode: null,
	};
}
