import { describe, expect, it } from "vitest";
import { moveCell, oppositeDirection } from "../core/railShape";
import { staticFabOrganizationEdgeKey } from "../core/StaticFabOrganization";
import {
	buildSyntheticFabStarter,
	defaultSyntheticFabStarterRequest,
	setSyntheticFabStarterParameter,
	syntheticFabStarterFullFabAssemblyPlan,
} from "./SyntheticFabStarter";

describe("Full FAB generator contacts", () => {
	it.each([
		[48, 80, 36, 40, "45f53175:e6c41c4c"],
		[64, 120, 60, 76, "8e34be30:913bb84c"],
	] as const)(
		"preserves every gateway and direct witness in the %i-Bay boundary profile",
		(bayCount, depth, frontage, pitch, physicalFingerprint) => {
			let request = defaultSyntheticFabStarterRequest("full-fab-52");
			for (const [key, value] of [
				["bayCount", bayCount],
				["aisleLengthMeters", depth],
				["laneSpacingMeters", frontage],
				["bayPitchMeters", pitch],
			] as const)
				request = setSyntheticFabStarterParameter(request, key, value);
			const plan = syntheticFabStarterFullFabAssemblyPlan(request);
			if (!plan) throw new Error("Expected Full plan.");
			const build = buildSyntheticFabStarter(request);
			expect(plan.profile).toEqual({
				bayCount,
				bayDepthMeters: depth,
				bayFrontageMeters: frontage,
				bayPitchMeters: pitch,
			});
			expect(build.physicalFingerprint).toBe(physicalFingerprint);
			expect(build.summary).toMatchObject({
				bayCount,
				zoneCount: 4,
				openTerminals: 0,
				strongComponents: 1,
			});
			const owners = new Map<string, number[]>();
			for (const record of build.document.organizations.records)
				for (const edge of record.membership.railEdges) {
					const key = staticFabOrganizationEdgeKey(edge);
					owners.set(key, [...(owners.get(key) ?? []), record.id]);
				}
			for (const gateway of plan.gateways) {
				const step = build.steps.find((row) => row.connectionId === gateway.id);
				expect(step?.junctions, gateway.id).toEqual(gateway.contract.exactJunctions);
				expect(step?.outboundTurns).toBe(0);
				expect(step?.returnTurns).toBe(0);
				expect(step?.addedEdges).toBe(gateway.ownerId === "FULL-FAB" ? 48 : 16);
				const expectedOwner =
					gateway.ownerId === "FULL-FAB"
						? 1
						: plan.banks.findIndex((bank) => bank.id === gateway.ownerId) + 2;
				const j = gateway.contract.exactJunctions;
				for (const [run, junctions] of [
					[gateway.contract.sourceRun, [j.sourceDeparture, j.sourceArrival]],
					[gateway.contract.targetRun, [j.targetDeparture, j.targetArrival]],
				] as const) {
					const owner =
						run.ownerId === "FULL-FAB"
							? 1
							: plan.banks.findIndex((bank) => bank.id === run.ownerId) + 2;
					for (const junction of junctions) {
						for (const edge of [
							{ from: moveCell(junction, oppositeDirection(run.flowDirection)), to: junction },
							{ from: junction, to: moveCell(junction, run.flowDirection) },
						])
							expect(owners.get(staticFabOrganizationEdgeKey(edge)), run.id).toEqual([owner]);
					}
				}
				for (const [from, to] of [
					[j.sourceDeparture, j.targetArrival],
					[j.targetDeparture, j.sourceArrival],
				]) {
					if (!from || !to) throw new Error("Expected exact junction pair.");
					const dx = Math.sign(to.x - from.x),
						dy = Math.sign(to.y - from.y);
					const length = Math.abs(to.x - from.x) + Math.abs(to.y - from.y);
					for (let n = 0; n < length; n++) {
						const edge = {
							from: { x: from.x + dx * n, y: from.y + dy * n },
							to: { x: from.x + dx * (n + 1), y: from.y + dy * (n + 1) },
						};
						expect(owners.get(staticFabOrganizationEdgeKey(edge)), gateway.id).toEqual([
							expectedOwner,
						]);
					}
				}
			}
			expect(build.document.relationships.records).toHaveLength(4);
			for (const record of build.document.relationships.records)
				for (const group of record.connectionGroups)
					for (const leg of group.legs)
						for (const seam of leg.seamContacts)
							for (const incidence of seam.incidences) {
								if (incidence.binding.kind !== "WITNESS")
									throw new Error("Expected non-detachable contact witness.");
								const { edge, scope } = incidence.binding.scopedEdge;
								expect(owners.get(staticFabOrganizationEdgeKey(edge))).toEqual(
									scope.kind === "PARENT_DIRECT"
										? [record.parentOrganizationId]
										: scope.directOwnerOrganizationIds,
								);
							}
		},
		60_000,
	);
});
