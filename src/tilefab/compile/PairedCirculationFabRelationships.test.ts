import { describe, expect, it } from "vitest";
import { DIR_E, DIR_W } from "../core/railShape";
import { staticFabOrganizationEdgeKey } from "../core/StaticFabOrganization";
import { createPairedCirculationFabAssemblyPlan } from "./PairedCirculationFabAssemblyPlan";
import {
	describePairedCirculationFabRelationships,
	pairedCirculationFabOrganizationIdentities,
} from "./PairedCirculationFabRelationships";
import { resolveStaticFabGeneratorRelationships } from "./StaticFabGeneratorRelationshipDescriptor";
import {
	buildSyntheticFabStarter,
	defaultSyntheticFabStarterRequest,
	setSyntheticFabStarterParameter,
} from "./SyntheticFabStarter";

const profile = { bayCount: 52, bayDepthMeters: 104, bayFrontageMeters: 40, bayPitchMeters: 48 };

describe("PairedCirculationFabRelationships", () => {
	it.each([
		48, 52, 56, 60, 64,
	])("declares every gateway in all four Banks for %i Bays", (bayCount) => {
		const plan = createPairedCirculationFabAssemblyPlan({ ...profile, bayCount });
		const descriptor = plan.relationships;
		const keys = descriptor.organizationKeys;
		expect(keys).toEqual(
			pairedCirculationFabOrganizationIdentities(plan.banks).map((row) => row.key),
		);
		expect(descriptor.relationships.nextRelationshipId).toBe(5);
		expect(descriptor.relationships.records).toHaveLength(4);
		for (const [bankIndex, record] of descriptor.relationships.records.entries()) {
			const bank = plan.banks[bankIndex];
			if (!bank) throw new Error("Expected declared Bank.");
			expect(record).toMatchObject({
				id: bankIndex + 1,
				hierarchyRole: "BANK_TO_FAB",
				parentOrganizationId: 1,
				participantOrganizationIds: [bankIndex + 2],
				managedChildOrganizationIds: [bankIndex + 2],
				reviewPolicy: "AUTHORING_NON_DETACHABLE",
			});
			expect(record.connectionGroups).toHaveLength(bayCount / 4);
			for (const [ordinal, group] of record.connectionGroups.entries()) {
				const bay = bank.bays[ordinal];
				if (!bay) throw new Error("Expected exact declared Bay.");
				expect(group.ordinal).toBe(ordinal);
				expect(group.legs).toHaveLength(1);
				const leg = group.legs[0];
				if (!leg) throw new Error("Expected contact leg.");
				expect(leg).toMatchObject({
					directionRole: "CONTACT",
					exclusiveCutEdges: [],
					endpointSupports: [],
				});
				expect(leg.seamContacts).toHaveLength(2);
				expect(leg.seamContacts.map((seam) => seam.role)).toEqual(
					bank.side === "north" ? ["BRANCH", "MERGE"] : ["MERGE", "BRANCH"],
				);
				const scopes = [];
				for (const seam of leg.seamContacts) {
					expect(seam.incidences).toHaveLength(3);
					const junction =
						seam.role === "BRANCH"
							? bay.gateway.exactJunctions.sourceDeparture
							: bay.gateway.exactJunctions.sourceArrival;
					for (const incidence of seam.incidences) {
						if (incidence.binding.kind !== "WITNESS")
							throw new Error("Contact cannot grant cut authority.");
						const { edge, scope } = incidence.binding.scopedEdge;
						expect(incidence.incidence === "INCOMING" ? edge.to : edge.from).toEqual(junction);
						if (scope.kind === "PARENT_DIRECT") {
							const step = bank.side === "north" ? 1 : -1;
							expect(edge).toEqual(
								incidence.incidence === "INCOMING"
									? { from: { x: junction.x - step, y: junction.y }, to: junction }
									: { from: junction, to: { x: junction.x + step, y: junction.y } },
							);
						} else {
							const neighbor = {
								x: junction.x,
								y: junction.y + (bank.side === "north" ? -1 : 1),
							};
							expect(incidence.incidence).toBe(seam.role === "BRANCH" ? "OUTGOING" : "INCOMING");
							expect(edge).toEqual(
								seam.role === "BRANCH"
									? { from: junction, to: neighbor }
									: { from: neighbor, to: junction },
							);
						}
						scopes.push(scope);
					}
				}
				expect(scopes.filter((scope) => scope.kind === "PARENT_DIRECT")).toHaveLength(4);
				const owners = scopes.filter((scope) => scope.kind === "PARTICIPANT_EFFECTIVE");
				expect(owners).toEqual(
					Array.from({ length: 2 }, () => ({
						kind: "PARTICIPANT_EFFECTIVE",
						participantIndex: 0,
						directOwnerOrganizationIds: [keys.indexOf(bay.id) + 1],
					})),
				);
			}
		}
	});

	it("remaps every nested Bay owner independently from its Bank participant", () => {
		const descriptor = createPairedCirculationFabAssemblyPlan(profile).relationships;
		const ids = new Map(descriptor.organizationKeys.map((key, index) => [key, 900 - index * 3]));
		const resolved = resolveStaticFabGeneratorRelationships(descriptor, ids);
		for (const [index, record] of resolved.records.entries()) {
			expect(record.parentOrganizationId).toBe(900);
			expect(record.participantOrganizationIds).toEqual([897 - index * 3]);
			const original = descriptor.relationships.records[index];
			if (!original) throw new Error("Expected original record.");
			for (const [groupIndex, group] of record.connectionGroups.entries()) {
				const scopes = group.legs.flatMap((leg) =>
					leg.seamContacts.flatMap((seam) =>
						seam.incidences.flatMap((incidence) =>
							incidence.binding.kind === "WITNESS" &&
							incidence.binding.scopedEdge.scope.kind === "PARTICIPANT_EFFECTIVE"
								? [incidence.binding.scopedEdge.scope]
								: [],
						),
					),
				);
				const originalScopes = original.connectionGroups[groupIndex]?.legs.flatMap((leg) =>
					leg.seamContacts.flatMap((seam) =>
						seam.incidences.flatMap((incidence) =>
							incidence.binding.kind === "WITNESS" &&
							incidence.binding.scopedEdge.scope.kind === "PARTICIPANT_EFFECTIVE"
								? [incidence.binding.scopedEdge.scope]
								: [],
						),
					),
				);
				expect(scopes).toHaveLength(2);
				expect(scopes.map((scope) => scope.directOwnerOrganizationIds)).toEqual(
					originalScopes?.map((scope) =>
						scope.directOwnerOrganizationIds.map((id) => 900 - (id - 1) * 3),
					),
				);
			}
		}
	});

	it("refuses a gateway that claims another Hall's interbay infrastructure", () => {
		const plan = createPairedCirculationFabAssemblyPlan(profile);
		const banks = structuredClone(plan.banks);
		const first = banks[0].bays[0];
		if (!first) throw new Error("Expected Bay.");
		(first.gateway.sourceRun as { ownerId: string }).ownerId = plan.halls[1].interbay.id;
		expect(() => describePairedCirculationFabRelationships(banks, plan.halls)).toThrow(
			/contact boundary/,
		);
	});

	it.each([
		"source-bounds",
		"target-bounds",
		"source-side",
		"target-side",
		"corridor",
		"source-direction",
		"target-position",
		"junction-anchor",
		"turn-count",
		"same-component",
	])("refuses changed %s in the declared gateway", (field) => {
		const plan = createPairedCirculationFabAssemblyPlan(profile);
		for (const bankIndex of [0, 1] as const) {
			const banks = structuredClone(plan.banks);
			const gateway = banks[bankIndex].bays[0]?.gateway;
			if (!gateway) throw new Error("Expected gateway.");
			if (field === "source-bounds") (gateway.sourceRun as { minimum: number }).minimum += 1;
			if (field === "target-bounds") (gateway.targetRun as { maximum: number }).maximum += 1;
			if (field === "source-side")
				(gateway.sourceRun as { side: string }).side = bankIndex === 0 ? "south" : "north";
			if (field === "target-side")
				(gateway.targetRun as { side: string }).side = bankIndex === 0 ? "north" : "south";
			if (field === "corridor") (gateway.corridor as { maxY: number }).maxY += 1;
			if (field === "source-direction")
				(gateway.sourceRun as { flowDirection: number }).flowDirection =
					bankIndex === 0 ? DIR_W : DIR_E;
			if (field === "target-position")
				(gateway.targetRun as { fixedCoordinate: number }).fixedCoordinate =
					gateway.sourceRun.fixedCoordinate;
			if (field === "junction-anchor") (gateway.targetAnchor as { x: number }).x += 1;
			if (field === "turn-count")
				(gateway as { expectedOutboundTurns: number }).expectedOutboundTurns = 2;
			if (field === "same-component")
				(gateway as { allowSameComponent: boolean }).allowSameComponent = true;
			expect(() => describePairedCirculationFabRelationships(banks, plan.halls)).toThrow(
				/contact boundary/,
			);
		}
	});

	it.each([
		[48, 80, 36, 44],
		[64, 120, 60, 80],
	])(
		"preserves exact direct owners in the real %i-Bay generator",
		(bayCount, depth, frontage, pitch) => {
			let request = defaultSyntheticFabStarterRequest("paired-circulation-fab-52");
			for (const [key, value] of [
				["bayCount", bayCount],
				["aisleLengthMeters", depth],
				["laneSpacingMeters", frontage],
				["bayPitchMeters", pitch],
			] as const)
				request = setSyntheticFabStarterParameter(request, key, value);
			const { document } = buildSyntheticFabStarter(request);
			const ownerIdsByEdge = new Map<string, number[]>();
			for (const organization of document.organizations.records)
				for (const edge of organization.membership.railEdges) {
					const key = staticFabOrganizationEdgeKey(edge);
					const owners = ownerIdsByEdge.get(key) ?? [];
					owners.push(organization.id);
					ownerIdsByEdge.set(key, owners);
				}
			expect(document.relationships.records).toHaveLength(4);
			for (const record of document.relationships.records) {
				expect(record.connectionGroups).toHaveLength(bayCount / 4);
				for (const group of record.connectionGroups)
					for (const leg of group.legs)
						for (const seam of leg.seamContacts)
							for (const incidence of seam.incidences) {
								if (incidence.binding.kind !== "WITNESS") throw new Error("Expected witness.");
								const { edge, scope } = incidence.binding.scopedEdge;
								expect(ownerIdsByEdge.get(staticFabOrganizationEdgeKey(edge))).toEqual(
									scope.kind === "PARENT_DIRECT"
										? [record.parentOrganizationId]
										: scope.directOwnerOrganizationIds,
								);
							}
			}
		},
		120_000,
	);
});
