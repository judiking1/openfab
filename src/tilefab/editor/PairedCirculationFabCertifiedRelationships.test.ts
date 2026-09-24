import { beforeAll, describe, expect, it } from "vitest";
import { defaultSyntheticFabStarterRequest } from "../compile/SyntheticFabStarter";
import {
	type PreparedSyntheticFabStarter,
	prepareSyntheticFabStarter,
} from "../compile/SyntheticFabStarterPreview";
import type { StaticFabAssemblyRelationshipStateV1 } from "../core/StaticFabAssemblyRelationship";
import { staticFabOrganizationBundleFingerprint } from "../core/StaticFabOrganizationBundlePlacement";
import generatedSource from "../generated/synthetic-fab-presets/paired-circulation-fab-52.default.v9.json?raw";
import { checksumRailMirrorSnapshot } from "../worker/RailMirrorChecksum";
import { hydrateRailMirrorSnapshotDocument } from "../worker/RailMirrorSnapshotDocument";
import {
	createStaticFabAssemblyRelationshipSnapshot,
	hydrateStaticFabAssemblyRelationshipSnapshot,
} from "../worker/StaticFabAssemblyRelationshipSoA";
import {
	createStaticFabOrganizationSnapshot,
	hydrateStaticFabOrganizationSnapshot,
} from "../worker/StaticFabOrganizationSoA";
import { preparedSyntheticFabStarterMatchesRequest } from "./SyntheticFabStarterBridge";
import {
	createSyntheticFabStarterCertifiedArtifact,
	hydrateSyntheticFabStarterCertifiedArtifact,
	type SyntheticFabStarterCertifiedArtifact,
} from "./SyntheticFabStarterCertifiedArtifact";

describe("Paired FAB certified relationship admission", () => {
	const request = defaultSyntheticFabStarterRequest("paired-circulation-fab-52");
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

	it("preserves every Bank and Bay contact in two builds, certified hydration and portable copies", () => {
		expect(artifact).toEqual(JSON.parse(generatedSource));
		expect(expected.records).toHaveLength(4);
		expect(expected.records.map((record) => record.connectionGroups.length)).toEqual([
			13, 13, 13, 13,
		]);
		const hydrated = hydrateSyntheticFabStarterCertifiedArtifact(artifact, request);
		if (!hydrated) throw new Error("Expected Paired artifact hydration.");
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
	])("rejects the missing final Bay contact after rehashing %s", (scope) => {
		const omitted = {
			...expected,
			records: expected.records.map((record, index) =>
				index === 3
					? { ...record, connectionGroups: record.connectionGroups.slice(0, -1) }
					: record,
			),
		};
		const candidate = withRelationships(primary, omitted, scope === "snapshot-and-bundle");
		expect(candidate.snapshot.checksum).toBe(checksumRailMirrorSnapshot(candidate.snapshot));
		expect(preparedSyntheticFabStarterMatchesRequest(candidate, request)).toBe(false);
		expect(() =>
			createSyntheticFabStarterCertifiedArtifact(
				candidate,
				withRelationships(independent, omitted, scope === "snapshot-and-bundle"),
				request,
			),
		).toThrow();
	});

	it("rejects a rehashed south contact that claims the neighboring Bay's direct ownership", () => {
		const altered = structuredClone(expected);
		const groups = altered.records[1]?.connectionGroups;
		if (!groups?.[0] || !groups[1]) throw new Error("Expected south Bank contacts.");
		const scopes = groups
			.slice(0, 2)
			.map((group) =>
				group.legs[0]?.seamContacts
					.flatMap((seam) => seam.incidences)
					.flatMap((incidence) =>
						incidence.binding.kind === "WITNESS" &&
						incidence.binding.scopedEdge.scope.kind === "PARTICIPANT_EFFECTIVE"
							? [incidence.binding.scopedEdge.scope]
							: [],
					),
			);
		const target = scopes[0]?.[0];
		const neighbor = scopes[1]?.[0];
		if (!target || !neighbor) throw new Error("Expected actual direct Bay owners.");
		(target.directOwnerOrganizationIds as number[])[0] = neighbor
			.directOwnerOrganizationIds[0] as number;
		// Portable admission validates ownership before it can issue a new fingerprint.
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
		expect(candidate.snapshot.checksum).toBe(checksumRailMirrorSnapshot(candidate.snapshot));
		expect(preparedSyntheticFabStarterMatchesRequest(candidate, request)).toBe(false);
		expect(() => hydrateRailMirrorSnapshotDocument(candidate.snapshot)).toThrow(/조립 관계/);
	});

	it("rejects rehashed Bay name swaps in both snapshot and portable identities", () => {
		const altered = structuredClone(primary);
		const organizations = hydrateStaticFabOrganizationSnapshot(altered.snapshot.organizations);
		const bayIndices = organizations.records.flatMap((record, index) =>
			record.kind === "BAY" ? [index] : [],
		);
		const [first, second] = bayIndices;
		if (first === undefined || second === undefined || !altered.placementBundle)
			throw new Error("Expected complete Bay identities.");
		const names = altered.snapshot.organizations.records.names as string[];
		[names[first], names[second]] = [names[second] as string, names[first] as string];
		const placementBundle = {
			...altered.placementBundle,
			organizations: altered.placementBundle.organizations.map((row, index) => ({
				...row,
				name: names[index] as string,
			})),
		};
		const checksum = checksumRailMirrorSnapshot(altered.snapshot);
		expect(
			preparedSyntheticFabStarterMatchesRequest(
				{
					...altered,
					authoredChecksum: checksum,
					snapshot: { ...altered.snapshot, checksum },
					placementBundle,
					placementBundleFingerprint: staticFabOrganizationBundleFingerprint(placementBundle),
				},
				request,
			),
		).toBe(false);
	});

	it("refuses changed direct Bay ownership even after the source checksum is recomputed", () => {
		const state = hydrateStaticFabOrganizationSnapshot(primary.snapshot.organizations);
		const [first, second] = state.records.filter((record) => record.kind === "BAY");
		if (!first || !second) throw new Error("Expected two Bay owners.");
		const organizations = createStaticFabOrganizationSnapshot({
			...state,
			records: state.records.map((row) => ({
				...row,
				membership:
					row.id === first.id
						? second.membership
						: row.id === second.id
							? first.membership
							: row.membership,
			})),
		});
		const changed = { ...primary.snapshot, organizations };
		expect(() =>
			hydrateRailMirrorSnapshotDocument({
				...changed,
				checksum: checksumRailMirrorSnapshot(changed),
			}),
		).toThrow(/조립 관계/);
	});
});

function withRelationships(
	prepared: PreparedSyntheticFabStarter,
	relationships: StaticFabAssemblyRelationshipStateV1,
	includeSnapshot: boolean,
): PreparedSyntheticFabStarter {
	if (!prepared.placementBundle) throw new Error("Expected Paired placement bundle.");
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
