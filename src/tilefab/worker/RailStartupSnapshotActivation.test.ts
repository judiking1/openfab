import { describe, expect, it } from "vitest";
import {
	createStaticFabAssemblyRelationshipState,
	type StaticFabAssemblyRelationshipStateV1,
} from "../core/StaticFabAssemblyRelationship";
import { checksumRailMirrorSnapshot } from "./RailMirrorChecksum";
import { compileRailStartup } from "./RailStartupRuntime";
import {
	releaseValidatedRailStartupSnapshotForFullValidation,
	validateAndHydrateRailStartupSnapshotCooperatively,
} from "./RailStartupSnapshotActivation";
import {
	type AdoptedRailStartupTransport,
	adoptRailStartupTransportCooperatively,
	type RailStartupTransport,
} from "./RailStartupTransportContract";
import { createStaticFabAssemblyRelationshipSnapshot } from "./StaticFabAssemblyRelationshipSoA";

describe("RailStartupSnapshotActivation relationships", () => {
	it("returns and release-binds the exact hydrated relationship generation and cursor", async () => {
		const adopted = await createAdoptedFixture(7);
		const validated = await validate(adopted);

		expect(validated.relationships).toEqual({ nextRelationshipId: 7, records: [] });
		expect(validated.nextRelationshipId).toBe(7);
		const equalCopy = createStaticFabAssemblyRelationshipState(validated.relationships);
		expect(
			releaseValidatedRailStartupSnapshotForFullValidation(
				validated.authority,
				validated.map,
				validated.portEquipment,
				validated.organizations,
				equalCopy,
			),
		).toBeNull();

		const second = await validate(await createAdoptedFixture(7));
		const snapshot = releaseValidatedRailStartupSnapshotForFullValidation(
			second.authority,
			second.map,
			second.portEquipment,
			second.organizations,
			second.relationships,
		);
		expect(snapshot?.relationships.nextRelationshipId).toBe(7);
	});

	it("checksum-rejects relationship cursor tampering after transport adoption", async () => {
		const adopted = await createAdoptedFixture();
		(
			adopted.value.snapshot.relationships as {
				nextRelationshipId: number;
			}
		).nextRelationshipId = 2;

		await expect(validate(adopted)).rejects.toThrow(/checksum/i);
	});

	it("rejects source-invalid relationships before issuing activation authority", async () => {
		const payload = compileRailStartup({ kind: "scale-probe", cellCount: 5 });
		payload.snapshot.relationships = createStaticFabAssemblyRelationshipSnapshot(
			createStaticFabAssemblyRelationshipState(sourceInvalidRelationship()),
		);
		payload.snapshot.checksum = checksumRailMirrorSnapshot(payload.snapshot);
		const adopted = await adopt(transportFromPayload(payload));

		await expect(validate(adopted)).rejects.toThrow(/조립 관계/);
	});
});

async function createAdoptedFixture(
	nextRelationshipId = 1,
): Promise<AdoptedRailStartupTransport<RailStartupTransport>> {
	const payload = compileRailStartup({ kind: "scale-probe", cellCount: 5 });
	if (nextRelationshipId !== 1) {
		payload.snapshot.relationships = createStaticFabAssemblyRelationshipSnapshot(
			createStaticFabAssemblyRelationshipState({ nextRelationshipId, records: [] }),
		);
		payload.snapshot.checksum = checksumRailMirrorSnapshot(payload.snapshot);
	}
	return adopt(transportFromPayload(payload));
}

function transportFromPayload(
	payload: ReturnType<typeof compileRailStartup>,
): RailStartupTransport {
	return {
		snapshot: payload.snapshot,
		analysis: payload.analysis.value,
		ownership: payload.ownership.value,
		physical: payload.physical.value,
		readiness: payload.readiness.value,
		renderArtifacts: payload.renderArtifacts.value,
		draftArtifacts: payload.draftArtifacts.value,
	};
}

function adopt(
	transport: RailStartupTransport,
): Promise<AdoptedRailStartupTransport<RailStartupTransport>> {
	return adoptRailStartupTransportCooperatively(
		transport,
		async () => undefined,
		() => undefined,
	);
}

function validate(adopted: AdoptedRailStartupTransport<RailStartupTransport>) {
	return validateAndHydrateRailStartupSnapshotCooperatively(
		adopted.value.snapshot,
		adopted.value,
		adopted.authority,
		async () => undefined,
		() => undefined,
		1,
	);
}

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
