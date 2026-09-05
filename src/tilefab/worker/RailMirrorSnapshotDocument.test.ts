import { describe, expect, it } from "vitest";
import { RailDocument } from "../core/RailDocument";
import {
	createStaticFabAssemblyRelationshipState,
	type StaticFabAssemblyRelationshipStateV1,
} from "../core/StaticFabAssemblyRelationship";
import { captureRailMirrorSnapshot } from "./RailMirrorChecksum";
import {
	hydrateRailMirrorSnapshotDiagnosticSource,
	hydrateRailMirrorSnapshotDocument,
} from "./RailMirrorSnapshotDocument";

describe("RailMirrorSnapshotDocument relationships", () => {
	it("hydrates the relationship cursor into diagnostic and activated document state", () => {
		const source = new RailDocument();
		const relationships = createStaticFabAssemblyRelationshipState({
			nextRelationshipId: 7,
			records: [],
		});
		const snapshot = captureRailMirrorSnapshot(
			source.map,
			source.getPatchSequence(),
			source.portEquipment,
			source.organizations,
			relationships,
		).snapshot;

		const diagnostic = hydrateRailMirrorSnapshotDiagnosticSource(snapshot);
		const activated = hydrateRailMirrorSnapshotDocument(snapshot);

		expect(diagnostic.relationships).toEqual(relationships);
		expect(diagnostic.relationships).not.toBe(relationships);
		expect(activated.relationships).toEqual(relationships);
		expect(activated.relationships).not.toBe(diagnostic.relationships);
	});

	it("checksum-binds the relationship cursor", () => {
		const source = new RailDocument();
		const snapshot = structuredClone(
			captureRailMirrorSnapshot(
				source.map,
				source.getPatchSequence(),
				source.portEquipment,
				source.organizations,
			).snapshot,
		);
		snapshot.relationships = {
			...snapshot.relationships,
			nextRelationshipId: 2,
		};

		expect(() => hydrateRailMirrorSnapshotDiagnosticSource(snapshot)).toThrow(/checksum/i);
	});

	it("retains source-invalid relationship records for diagnostics but refuses activation", () => {
		const source = new RailDocument();
		const relationships = createStaticFabAssemblyRelationshipState(sourceInvalidRelationship());
		const snapshot = captureRailMirrorSnapshot(
			source.map,
			source.getPatchSequence(),
			source.portEquipment,
			source.organizations,
			relationships,
		).snapshot;

		expect(hydrateRailMirrorSnapshotDiagnosticSource(snapshot).relationships).toEqual(
			relationships,
		);
		expect(() => hydrateRailMirrorSnapshotDocument(snapshot)).toThrow(/조립 관계/);
	});
});

function sourceInvalidRelationship(): StaticFabAssemblyRelationshipStateV1 {
	return {
		nextRelationshipId: 2,
		records: [
			{
				id: 1,
				hierarchyRole: "BAY_TO_BANK",
				purpose: "HIERARCHY_LINK",
				parentOrganizationId: 1,
				participantOrganizationIds: [2],
				managedChildOrganizationIds: [2],
				reviewPolicy: "AUTHORING_NON_DETACHABLE",
				connectionGroups: [
					{
						ordinal: 0,
						legs: [
							{
								ordinal: 0,
								directionRole: "CONTACT",
								exclusiveCutEdges: [],
								endpointSupports: [],
								seamContacts: [
									{
										role: "CONTACT",
										incidences: [
											{
												incidence: "INCOMING",
												binding: {
													kind: "WITNESS",
													scopedEdge: {
														edge: { from: { x: 0, y: 0 }, to: { x: 1, y: 0 } },
														scope: { kind: "PARENT_DIRECT" },
													},
												},
											},
											{
												incidence: "OUTGOING",
												binding: {
													kind: "WITNESS",
													scopedEdge: {
														edge: { from: { x: 1, y: 0 }, to: { x: 2, y: 0 } },
														scope: {
															kind: "PARTICIPANT_EFFECTIVE",
															participantIndex: 0,
															directOwnerOrganizationIds: [2],
														},
													},
												},
											},
										],
									},
								],
							},
						],
					},
				],
			},
		],
	};
}
