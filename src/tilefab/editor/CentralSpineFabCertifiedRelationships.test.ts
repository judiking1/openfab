import { beforeAll, describe, expect, it } from "vitest";
import { defaultSyntheticFabStarterRequest } from "../compile/SyntheticFabStarter";
import {
	type PreparedSyntheticFabStarter,
	prepareSyntheticFabStarter,
} from "../compile/SyntheticFabStarterPreview";
import type { StaticFabAssemblyRelationshipStateV1 } from "../core/StaticFabAssemblyRelationship";
import { staticFabOrganizationBundleFingerprint } from "../core/StaticFabOrganizationBundlePlacement";
import generatedSource from "../generated/synthetic-fab-presets/central-spine-fab-24.default.v8.json?raw";
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

describe("Central Spine certified relationship admission", () => {
	const request = defaultSyntheticFabStarterRequest("central-spine-fab-24");
	let primary: PreparedSyntheticFabStarter,
		independent: PreparedSyntheticFabStarter,
		artifact: SyntheticFabStarterCertifiedArtifact,
		expected: StaticFabAssemblyRelationshipStateV1;
	beforeAll(() => {
		primary = prepareSyntheticFabStarter(request);
		independent = prepareSyntheticFabStarter(request);
		artifact = createSyntheticFabStarterCertifiedArtifact(primary, independent, request);
		expected = hydrateStaticFabAssemblyRelationshipSnapshot(primary.snapshot.relationships);
	}, 30_000);
	it("preserves all 24 Bays and both Loop contacts through certification and portable hydration", () => {
		expect(artifact).toEqual(JSON.parse(generatedSource));
		expect(expected.records.map((record) => record.connectionGroups.length)).toEqual(
			Array(24).fill(3),
		);
		const hydrated = hydrateSyntheticFabStarterCertifiedArtifact(artifact, request);
		if (!hydrated) throw new Error("Expected Central Spine hydration.");
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
	])("rejects an omitted Bay or inner Loop after rehashing %s", (scope) => {
		for (const omitted of [
			{ nextRelationshipId: 24, records: expected.records.slice(0, -1) },
			{
				...expected,
				records: expected.records.map((record, index) =>
					index === 23
						? { ...record, connectionGroups: record.connectionGroups.slice(0, 2) }
						: record,
				),
			},
		]) {
			const candidate = withRelationships(primary, omitted, scope === "snapshot-and-bundle");
			expect(candidate.snapshot.checksum).toBe(checksumRailMirrorSnapshot(candidate.snapshot));
			expect(preparedSyntheticFabStarterMatchesRequest(candidate, request)).toBe(false);
			expect(() =>
				createSyntheticFabStarterCertifiedArtifact(
					candidate,
					withRelationships(independent, omitted, scope === "snapshot-and-bundle"),
					request,
				),
			).toThrow("Independent starter preparations do not match.");
		}
	});
	it.each([
		[0, 2],
		[0, 4],
		[23, 71],
		[23, 73],
	] as const)("rejects Bay record %i Loop contact reassigned to ancestor or sibling %i", (recordIndex, wrongOwner) => {
		const altered = structuredClone(expected);
		const scope = altered.records[recordIndex]?.connectionGroups[1]?.legs[0]?.seamContacts
			.flatMap((seam) => seam.incidences)
			.flatMap((incidence) =>
				incidence.binding.kind === "WITNESS" &&
				incidence.binding.scopedEdge.scope.kind === "PARTICIPANT_EFFECTIVE"
					? [incidence.binding.scopedEdge.scope]
					: [],
			)[0];
		if (!scope) throw new Error("Expected direct Loop witness.");
		(scope.directOwnerOrganizationIds as number[])[0] = wrongOwner;
		expect(() => withRelationships(primary, altered, true)).toThrow(/직접 소유자/);
		const snapshot = {
			...primary.snapshot,
			relationships: createStaticFabAssemblyRelationshipSnapshot(altered),
		};
		const checksum = checksumRailMirrorSnapshot(snapshot),
			candidate = { ...primary, authoredChecksum: checksum, snapshot: { ...snapshot, checksum } };
		expect(preparedSyntheticFabStarterMatchesRequest(candidate, request)).toBe(false);
		expect(() => hydrateRailMirrorSnapshotDocument(candidate.snapshot)).toThrow(/조립 관계/);
	});
	it.each([
		"snapshot-and-bundle",
		"bundle-only",
	])("rejects otherwise valid Loop identity swaps in %s", (scope) => {
		const copy = structuredClone(primary);
		if (!copy.placementBundle) throw new Error("Expected Central portable hierarchy.");
		const names = [...copy.snapshot.organizations.records.names];
		[names[2], names[3]] = [names[3] as string, names[2] as string];
		const snapshot =
			scope === "snapshot-and-bundle"
				? {
						...copy.snapshot,
						organizations: {
							...copy.snapshot.organizations,
							records: { ...copy.snapshot.organizations.records, names },
						},
					}
				: copy.snapshot;
		const checksum = checksumRailMirrorSnapshot(snapshot);
		const placementBundle = {
			...copy.placementBundle,
			organizations: copy.placementBundle.organizations.map((row, index) => ({
				...row,
				name: names[index] as string,
			})),
		};
		expect(
			preparedSyntheticFabStarterMatchesRequest(
				{
					...copy,
					authoredChecksum: checksum,
					snapshot: { ...snapshot, checksum },
					placementBundle,
					placementBundleFingerprint: staticFabOrganizationBundleFingerprint(placementBundle),
				},
				request,
			),
		).toBe(false);
	});
	it.each([
		"outboundTurns",
		"returnTurns",
	] as const)("rejects invented %s on root, Bay and Loop template operations", (field) => {
		for (const index of [0, 1, 2, 3, 4, 71, 72, 73]) {
			const altered = {
				...primary,
				steps: primary.steps.map((step, ordinal) =>
					ordinal === index ? { ...step, [field]: 0 } : step,
				),
			};
			expect(preparedSyntheticFabStarterMatchesRequest(altered, request), `step ${index}`).toBe(
				false,
			);
		}
	});
	it("rejects rehashed direct Loop membership swaps within one Bay", () => {
		const state = hydrateStaticFabOrganizationSnapshot(primary.snapshot.organizations);
		const first = state.records[2],
			second = state.records[3];
		if (!first || !second) throw new Error("Expected the first Bay's two Process Loops.");
		expect([first.kind, second.kind]).toEqual(["AISLE", "AISLE"]);
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
		const snapshot = { ...primary.snapshot, organizations };
		expect(() =>
			hydrateRailMirrorSnapshotDocument({
				...snapshot,
				checksum: checksumRailMirrorSnapshot(snapshot),
			}),
		).toThrow(/조립 관계/);
	});
});

function withRelationships(
	prepared: PreparedSyntheticFabStarter,
	relationships: StaticFabAssemblyRelationshipStateV1,
	includeSnapshot: boolean,
): PreparedSyntheticFabStarter {
	if (!prepared.placementBundle) throw new Error("Expected Central placement bundle.");
	const snapshot = includeSnapshot
		? {
				...prepared.snapshot,
				relationships: createStaticFabAssemblyRelationshipSnapshot(relationships),
			}
		: prepared.snapshot;
	const checksum = checksumRailMirrorSnapshot(snapshot),
		placementBundle = { ...prepared.placementBundle, relationships };
	return {
		...prepared,
		authoredChecksum: checksum,
		snapshot: { ...snapshot, checksum },
		placementBundle,
		placementBundleFingerprint: staticFabOrganizationBundleFingerprint(placementBundle),
	};
}
