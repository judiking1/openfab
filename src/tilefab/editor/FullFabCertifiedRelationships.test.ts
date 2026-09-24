import { beforeAll, describe, expect, it } from "vitest";
import { defaultSyntheticFabStarterRequest } from "../compile/SyntheticFabStarter";
import {
	type PreparedSyntheticFabStarter,
	prepareSyntheticFabStarter,
} from "../compile/SyntheticFabStarterPreview";
import type { StaticFabAssemblyRelationshipStateV1 } from "../core/StaticFabAssemblyRelationship";
import { staticFabOrganizationBundleFingerprint } from "../core/StaticFabOrganizationBundlePlacement";
import generatedSource from "../generated/synthetic-fab-presets/full-fab-52.default.v7.json?raw";
import { checksumRailMirrorSnapshot } from "../worker/RailMirrorChecksum";
import { hydrateRailMirrorSnapshotDocument } from "../worker/RailMirrorSnapshotDocument";
import {
	createStaticFabAssemblyRelationshipSnapshot,
	hydrateStaticFabAssemblyRelationshipSnapshot,
} from "../worker/StaticFabAssemblyRelationshipSoA";
import { preparedSyntheticFabStarterMatchesRequest } from "./SyntheticFabStarterBridge";
import {
	createSyntheticFabStarterCertifiedArtifact,
	hydrateSyntheticFabStarterCertifiedArtifact,
	type SyntheticFabStarterCertifiedArtifact,
} from "./SyntheticFabStarterCertifiedArtifact";

describe("Full FAB certified relationship admission", () => {
	const request = defaultSyntheticFabStarterRequest("full-fab-52");
	let primary: PreparedSyntheticFabStarter;
	let independent: PreparedSyntheticFabStarter;
	let artifact: SyntheticFabStarterCertifiedArtifact;
	let expected: StaticFabAssemblyRelationshipStateV1;
	beforeAll(() => {
		primary = prepareSyntheticFabStarter(request);
		independent = prepareSyntheticFabStarter(request);
		artifact = createSyntheticFabStarterCertifiedArtifact(primary, independent, request);
		expected = hydrateStaticFabAssemblyRelationshipSnapshot(primary.snapshot.relationships);
	}, 60_000);

	it("preserves all four Bank contacts through independent certification and portable hydration", () => {
		expect(artifact).toEqual(JSON.parse(generatedSource));
		expect(expected.records.map((record) => record.connectionGroups.length)).toEqual([1, 1, 1, 1]);
		const hydrated = hydrateSyntheticFabStarterCertifiedArtifact(artifact, request);
		if (!hydrated) throw new Error("Expected Full hydration.");
		for (const candidate of [primary, independent, hydrated.prepared]) {
			expect(
				hydrateStaticFabAssemblyRelationshipSnapshot(candidate.snapshot.relationships),
			).toEqual(expected);
			expect(candidate.placementBundle?.relationships).toEqual(expected);
			expect(candidate.authoredChecksum).toBe(primary.authoredChecksum);
			expect(preparedSyntheticFabStarterMatchesRequest(candidate, request)).toBe(true);
		}
	});

	it.each([
		"snapshot-and-bundle",
		"bundle-only",
	])("rejects an omitted Hall 2 Bank contact after rehashing %s", (scope) => {
		const relationships = { nextRelationshipId: 4, records: expected.records.slice(0, -1) };
		const candidate = withRelationships(primary, relationships, scope === "snapshot-and-bundle");
		expect(candidate.snapshot.checksum).toBe(checksumRailMirrorSnapshot(candidate.snapshot));
		expect(preparedSyntheticFabStarterMatchesRequest(candidate, request)).toBe(false);
		expect(() =>
			createSyntheticFabStarterCertifiedArtifact(
				candidate,
				withRelationships(independent, relationships, scope === "snapshot-and-bundle"),
				request,
			),
		).toThrow("Independent starter preparations do not match.");
	});

	it.each([
		"sourceDeparture",
		"sourceArrival",
		"targetDeparture",
		"targetArrival",
	] as const)("rejects a changed %s in each of eight gateway steps", (field) => {
		const gateways = primary.steps.flatMap((step, index) =>
			step.kind === "network-link" ? [index] : [],
		);
		expect(gateways).toHaveLength(8);
		for (const index of gateways) {
			const step = primary.steps[index];
			if (!step?.junctions) throw new Error("Expected gateway junctions.");
			const altered = {
				...step,
				junctions: {
					...step.junctions,
					[field]: { ...step.junctions[field], x: step.junctions[field].x + 1 },
				},
			};
			const candidate = {
				...primary,
				steps: primary.steps.map((row, i) => (i === index ? altered : row)),
			};
			expect(
				preparedSyntheticFabStarterMatchesRequest(candidate, request),
				step.connectionId ?? undefined,
			).toBe(false);
		}
	});

	it.each([
		"snapshot-and-bundle",
		"bundle-only",
	])("rejects otherwise valid Bay name swaps in %s identities", (scope) => {
		const altered = structuredClone(primary);
		if (!altered.placementBundle) throw new Error("Expected portable Full hierarchy.");
		// IDs 1-5 are Fab and all four Banks; IDs 6/9 are the first two Bays.
		const names = [...altered.snapshot.organizations.records.names];
		[names[5], names[8]] = [names[8] as string, names[5] as string];
		const snapshot =
			scope === "snapshot-and-bundle"
				? {
						...altered.snapshot,
						organizations: {
							...altered.snapshot.organizations,
							records: { ...altered.snapshot.organizations.records, names },
						},
					}
				: altered.snapshot;
		const checksum = checksumRailMirrorSnapshot(snapshot);
		const placementBundle = {
			...altered.placementBundle,
			organizations: altered.placementBundle.organizations.map((row, index) => ({
				...row,
				name: names[index] as string,
			})),
		};
		expect(
			preparedSyntheticFabStarterMatchesRequest(
				{
					...altered,
					authoredChecksum: checksum,
					snapshot: { ...snapshot, checksum },
					placementBundle,
					placementBundleFingerprint: staticFabOrganizationBundleFingerprint(placementBundle),
				},
				request,
			),
		).toBe(false);
	});

	it("rejects a same-side Bank witness owned by the other Hall", () => {
		const altered = structuredClone(expected);
		const scope = altered.records[0]?.connectionGroups[0]?.legs[0]?.seamContacts
			.flatMap((seam) => seam.incidences)
			.flatMap((incidence) =>
				incidence.binding.kind === "WITNESS" &&
				incidence.binding.scopedEdge.scope.kind === "PARTICIPANT_EFFECTIVE"
					? [incidence.binding.scopedEdge.scope]
					: [],
			)[0];
		if (!scope) throw new Error("Expected direct Bank witness.");
		(scope.directOwnerOrganizationIds as number[])[0] = 4;
		expect(() => withRelationships(primary, altered, true)).toThrow(/직접 소유자/);
		const snapshot = {
			...primary.snapshot,
			relationships: createStaticFabAssemblyRelationshipSnapshot(altered),
		};
		const checksum = checksumRailMirrorSnapshot(snapshot);
		const candidate = {
			...primary,
			authoredChecksum: checksum,
			snapshot: { ...snapshot, checksum },
		};
		expect(preparedSyntheticFabStarterMatchesRequest(candidate, request)).toBe(false);
		expect(() => hydrateRailMirrorSnapshotDocument(candidate.snapshot)).toThrow(/조립 관계/);
	});
});

function withRelationships(
	prepared: PreparedSyntheticFabStarter,
	relationships: StaticFabAssemblyRelationshipStateV1,
	includeSnapshot: boolean,
): PreparedSyntheticFabStarter {
	if (!prepared.placementBundle) throw new Error("Expected Full placement bundle.");
	const snapshot = includeSnapshot
		? {
				...prepared.snapshot,
				relationships: createStaticFabAssemblyRelationshipSnapshot(relationships),
			}
		: prepared.snapshot;
	const checksum = checksumRailMirrorSnapshot(snapshot);
	const placementBundle = { ...prepared.placementBundle, relationships };
	return {
		...prepared,
		authoredChecksum: checksum,
		snapshot: { ...snapshot, checksum },
		placementBundle,
		placementBundleFingerprint: staticFabOrganizationBundleFingerprint(placementBundle),
	};
}
