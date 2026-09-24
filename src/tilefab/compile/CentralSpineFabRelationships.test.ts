import { describe, expect, it } from "vitest";
import { DIR_E, DIR_N, DIR_S, DIR_W, moveCell, oppositeDirection } from "../core/railShape";
import {
	deriveStaticFabOrganizationSemanticRoles,
	staticFabOrganizationEdgeKey,
} from "../core/StaticFabOrganization";
import { decodeRailCell } from "../core/TileMap";
import {
	captureOpenFabProject,
	createOpenFabProjectManifest,
	createRailSnapshotFromOpenFabProject,
} from "../project/OpenFabProject";
import { parseOpenFabProjectJson, serializeOpenFabProject } from "../project/OpenFabProjectCodec";
import { hydrateRailMirrorSnapshotDocument } from "../worker/RailMirrorSnapshotDocument";
import { resolveStaticFabGeneratorRelationships } from "./StaticFabGeneratorRelationshipDescriptor";
import {
	buildSyntheticFabStarter,
	defaultSyntheticFabStarterRequest,
	setSyntheticFabStarterParameter,
	syntheticFabStarterCentralSpineAssemblyPlan,
} from "./SyntheticFabStarter";

describe("Central Spine declared Bay relationships", () => {
	it.each([
		[24, 72, 48, 52, "faf3a425:9cd663a4"],
		[16, 56, 48, 52, "1dbd3214:20210417"],
		[32, 120, 64, 80, "f996e76d:623e8100"],
		[17, 72, 48, 52, "26c45816:5cfa26bf"],
	] as const)(
		"preserves %i Bays, all six contacts per Bay and native identity",
		(count, depth, frontage, pitch, physical) => {
			let request = defaultSyntheticFabStarterRequest("central-spine-fab-24");
			for (const [key, value] of [
				["bayCount", count],
				["aisleLengthMeters", depth],
				["laneSpacingMeters", frontage],
				["bayPitchMeters", pitch],
			] as const)
				request = setSyntheticFabStarterParameter(request, key, value);
			const plan = syntheticFabStarterCentralSpineAssemblyPlan(request);
			if (!plan) throw new Error("Expected Central Spine plan.");
			expect(plan.profile).toEqual({
				bayCount: count,
				bayDepthMeters: depth,
				bayFrontageMeters: frontage,
				bayPitchMeters: pitch,
			});
			const build = buildSyntheticFabStarter(request),
				document = build.document;
			expect(build.physicalFingerprint).toBe(physical);
			expect(build.summary).toMatchObject({
				bayCount: count,
				openTerminals: 0,
				strongComponents: 1,
			});
			expect(deriveStaticFabOrganizationSemanticRoles(document.organizations).get(1)).toBe(
				"BAY_BANK",
			);
			expect(document.organizations.records).toHaveLength(1 + 3 * count);
			expect(document.relationships.records).toHaveLength(count);
			expect(document.relationships.nextRelationshipId).toBe(count + 1);
			const owners = new Map<string, number[]>();
			for (const record of document.organizations.records)
				for (const edge of record.membership.railEdges) {
					const key = staticFabOrganizationEdgeKey(edge);
					owners.set(key, [...(owners.get(key) ?? []), record.id]);
				}
			for (const [index, bay] of plan.banks.flatMap((bank) => bank.bays).entries()) {
				const record = document.relationships.records[index];
				if (!record) throw new Error("Missing declared Bay relationship.");
				const bayId = 2 + index * 3,
					north = bay.side === "north",
					flow = north ? DIR_E : DIR_W,
					side = north ? DIR_N : DIR_S;
				expect(record).toMatchObject({
					id: index + 1,
					parentOrganizationId: 1,
					hierarchyRole: "BAY_TO_BANK",
					participantOrganizationIds: [bayId],
					managedChildOrganizationIds: [bayId],
					reviewPolicy: "AUTHORING_NON_DETACHABLE",
				});
				expect(record.connectionGroups).toHaveLength(3);
				for (const [ordinal, operation] of [bay, ...bay.processLoops].entries()) {
					const leg = record.connectionGroups[ordinal]?.legs[0];
					if (!leg) throw new Error("Missing declared operation contact group.");
					expect(leg.directionRole).toBe("CONTACT");
					expect(leg.exclusiveCutEdges).toEqual([]);
					expect(leg.endpointSupports).toEqual([]);
					expect(leg.seamContacts).toHaveLength(2);
					const end = {
						x: operation.anchor.x + (north ? operation.frontageMeters : -operation.frontageMeters),
						y: operation.anchor.y,
					};
					const declared = [
						{ cell: operation.anchor, role: ordinal === 0 ? "MERGE" : "BRANCH" },
						{ cell: end, role: ordinal === 0 ? "BRANCH" : "MERGE" },
					].sort((a, b) => a.cell.x - b.cell.x);
					for (const [seamIndex, seam] of leg.seamContacts.entries()) {
						const expected = declared[seamIndex];
						if (!expected) throw new Error("Missing independent seam expectation.");
						expect(seam.role).toBe(expected.role);
						const j = expected.cell;
						expect(decodeRailCell(document.map.getEncoded(j.x, j.y))).toEqual({
							incoming: oppositeDirection(flow) | (expected.role === "MERGE" ? side : 0),
							outgoing: flow | (expected.role === "BRANCH" ? side : 0),
						});
						const expectedEdges = [
							{ from: moveCell(j, oppositeDirection(flow)), to: j },
							{ from: j, to: moveCell(j, flow) },
							expected.role === "BRANCH"
								? { from: j, to: moveCell(j, side) }
								: { from: moveCell(j, side), to: j },
						];
						const actualEdges = seam.incidences.map((incidence) => {
							if (incidence.binding.kind !== "WITNESS")
								throw new Error("Expected contact-only witness.");
							const { edge, scope } = incidence.binding.scopedEdge;
							expect(owners.get(staticFabOrganizationEdgeKey(edge))).toEqual(
								scope.kind === "PARENT_DIRECT" ? [1] : [bayId + ordinal],
							);
							if (scope.kind !== "PARENT_DIRECT")
								expect(scope.directOwnerOrganizationIds).toEqual([bayId + ordinal]);
							return staticFabOrganizationEdgeKey(edge);
						});
						expect(actualEdges.sort()).toEqual(
							expectedEdges.map(staticFabOrganizationEdgeKey).sort(),
						);
					}
				}
			}
			const project = captureOpenFabProject(document, {
				manifest: createOpenFabProjectManifest(
					"central-relationships",
					"Central Spine",
					"2026-09-25T00:00:00.000Z",
				),
			});
			const reopened = createRailSnapshotFromOpenFabProject(
				parseOpenFabProjectJson(serializeOpenFabProject(project)).project,
			);
			expect(reopened.checksum).toBe(build.authoredChecksum);
			expect(hydrateRailMirrorSnapshotDocument(reopened).relationships).toEqual(
				document.relationships,
			);
			const ids = new Map(
				plan.relationships.organizationKeys.map((key, index) => [key, 1000 - index * 7]),
			);
			const remapped = resolveStaticFabGeneratorRelationships(plan.relationships, ids);
			for (const [index, record] of remapped.records.entries()) {
				expect(record.parentOrganizationId).toBe(1000);
				expect(record.participantOrganizationIds).toEqual([1000 - (1 + 3 * index) * 7]);
				for (const group of record.connectionGroups)
					for (const seam of group.legs[0]?.seamContacts ?? [])
						for (const incidence of seam.incidences)
							if (
								incidence.binding.kind === "WITNESS" &&
								incidence.binding.scopedEdge.scope.kind === "PARTICIPANT_EFFECTIVE"
							)
								expect(incidence.binding.scopedEdge.scope.directOwnerOrganizationIds).toEqual([
									1000 - (1 + 3 * index + group.ordinal) * 7,
								]);
			}
		},
		30_000,
	);
});
