import { describe, expect, it } from "vitest";
import { defaultSyntheticFabStarterRequest } from "../compile/SyntheticFabStarter";
import { prepareSyntheticFabStarter } from "../compile/SyntheticFabStarterPreview";
import { RailDocument } from "../core/RailDocument";
import type { StaticFabOrganizationBundle } from "../core/StaticFabOrganizationBundle";
import {
	adoptStaticFabOrganizationBundlePlacementWorkerPlan,
	issueStaticFabOrganizationBundlePlacementPermit,
	type StaticFabOrganizationBundlePlacementPlan,
	staticFabOrganizationBundleFingerprint,
} from "../core/StaticFabOrganizationBundlePlacement";
import { captureRailMirrorSnapshot, checksumRailMap } from "../worker/RailMirrorChecksum";
import { prepareStaticFabOrganizationBundlePlacement } from "../worker/StaticFabOrganizationBundlePlacementRuntime";

describe("Synthetic FAB preset repeat placement", () => {
	it("places the same Parallel Hall FAB twice with fresh IDs and one undo command per FAB", () => {
		const prepared = prepareSyntheticFabStarter(
			defaultSyntheticFabStarterRequest("parallel-hall-fab-12"),
		);
		const bundle = prepared.placementBundle;
		if (!bundle) throw new Error("Parallel Hall preset must expose a placement bundle.");
		const document = new RailDocument();
		const first = adoptedWorkerPlan(document, bundle, { x: 0, y: 0 });
		expect(document.commitStaticFabOrganizationBundle(first)).toBe(true);
		const firstChecksum = checksumRailMap(
			document.map,
			document.portEquipment,
			document.organizations,
		);
		expect(document.organizations.records).toHaveLength(39);
		const firstSnapshot = captureRailMirrorSnapshot(
			document.map,
			document.getPatchSequence(),
			document.portEquipment,
			document.organizations,
		).snapshot;
		const firstOrganizations = document.organizations.records;

		const second = adoptedWorkerPlan(document, bundle, {
			x: bundle.sourceWidthMeters + 40,
			y: 0,
		});
		expect(document.commitStaticFabOrganizationBundle(second)).toBe(true);
		expect(document.getPatchSequence()).toBe(2);
		expect(document.organizations.records).toHaveLength(78);
		expect(new Set(document.organizations.records.map((record) => record.id)).size).toBe(78);
		expect(new Set(document.organizations.records.map((record) => record.name)).size).toBe(78);
		const repeatedChecksum = checksumRailMap(
			document.map,
			document.portEquipment,
			document.organizations,
		);
		expect(repeatedChecksum).not.toBe(firstChecksum);

		expect(document.undo()).toBe(true);
		expect(document.organizations.records).toHaveLength(39);
		const undoneSnapshot = captureRailMirrorSnapshot(
			document.map,
			document.getPatchSequence(),
			document.portEquipment,
			document.organizations,
		).snapshot;
		expect([...undoneSnapshot.xs]).toEqual([...firstSnapshot.xs]);
		expect([...undoneSnapshot.ys]).toEqual([...firstSnapshot.ys]);
		expect([...undoneSnapshot.encoded]).toEqual([...firstSnapshot.encoded]);
		expect(document.organizations.records).toEqual(firstOrganizations);
		expect(document.redo()).toBe(true);
		expect(document.organizations.records).toHaveLength(78);
		expect(checksumRailMap(document.map, document.portEquipment, document.organizations)).toBe(
			repeatedChecksum,
		);
	}, 30_000);

	it("places two independent Full FABs on one map and preserves atomic undo/redo", () => {
		const prepared = prepareSyntheticFabStarter(defaultSyntheticFabStarterRequest("full-fab-52"));
		const bundle = prepared.placementBundle;
		if (!bundle) throw new Error("Full FAB preset must expose a placement bundle.");
		const document = new RailDocument();

		const first = adoptedWorkerPlan(document, bundle, { x: 0, y: 0 });
		expect(document.commitStaticFabOrganizationBundle(first)).toBe(true);
		const firstSnapshot = captureRailMirrorSnapshot(
			document.map,
			document.getPatchSequence(),
			document.portEquipment,
			document.organizations,
		).snapshot;
		expect(firstSnapshot.xs).toHaveLength(44_068);
		expect(document.organizations.records).toHaveLength(161);

		const second = adoptedWorkerPlan(document, bundle, {
			x: bundle.sourceWidthMeters + 80,
			y: bundle.sourceHeightMeters + 80,
		});
		expect(document.commitStaticFabOrganizationBundle(second)).toBe(true);
		const repeatedSnapshot = captureRailMirrorSnapshot(
			document.map,
			document.getPatchSequence(),
			document.portEquipment,
			document.organizations,
		).snapshot;
		expect(repeatedSnapshot.xs).toHaveLength(88_136);
		expect(document.getPatchSequence()).toBe(2);
		expect(document.organizations.records).toHaveLength(322);
		expect(new Set(document.organizations.records.map((record) => record.id)).size).toBe(322);

		expect(document.undo()).toBe(true);
		expect(document.organizations.records).toHaveLength(161);
		expect(document.redo()).toBe(true);
		expect(document.organizations.records).toHaveLength(322);
		expect(
			captureRailMirrorSnapshot(
				document.map,
				document.getPatchSequence(),
				document.portEquipment,
				document.organizations,
			).snapshot.xs,
		).toHaveLength(88_136);
	}, 60_000);

	it("places two independent Paired Circulation FABs with fresh hierarchy IDs", () => {
		const prepared = prepareSyntheticFabStarter(
			defaultSyntheticFabStarterRequest("paired-circulation-fab-52"),
		);
		const bundle = prepared.placementBundle;
		if (!bundle) throw new Error("Paired Circulation FAB must expose a placement bundle.");
		const document = new RailDocument();

		const first = adoptedWorkerPlan(document, bundle, { x: 0, y: 0 });
		expect(document.commitStaticFabOrganizationBundle(first)).toBe(true);
		expect(document.map.size).toBe(33_663);
		expect(document.organizations.records).toHaveLength(144);

		const second = adoptedWorkerPlan(document, bundle, {
			x: bundle.sourceWidthMeters + 80,
			y: bundle.sourceHeightMeters + 80,
		});
		expect(document.commitStaticFabOrganizationBundle(second)).toBe(true);
		expect(document.map.size).toBe(67_326);
		expect(document.getPatchSequence()).toBe(2);
		expect(document.organizations.records).toHaveLength(288);
		expect(new Set(document.organizations.records.map((record) => record.id)).size).toBe(288);
		expect(new Set(document.organizations.records.map((record) => record.name)).size).toBe(288);

		expect(document.undo()).toBe(true);
		expect(document.map.size).toBe(33_663);
		expect(document.organizations.records).toHaveLength(144);
		expect(document.redo()).toBe(true);
		expect(document.map.size).toBe(67_326);
		expect(document.organizations.records).toHaveLength(288);
	}, 60_000);
});

function adoptedWorkerPlan(
	document: RailDocument,
	bundle: StaticFabOrganizationBundle,
	anchor: Readonly<{ x: number; y: number }>,
): StaticFabOrganizationBundlePlacementPlan {
	const snapshot = captureRailMirrorSnapshot(
		document.map,
		document.getPatchSequence(),
		document.portEquipment,
		document.organizations,
	).snapshot;
	const permit = issueStaticFabOrganizationBundlePlacementPermit(
		document.map,
		document.portEquipment,
		document.getPatchSequence(),
		document.organizations,
		bundle,
		anchor,
		0,
		snapshot.checksum,
	);
	const prepared = prepareStaticFabOrganizationBundlePlacement({
		type: "PREPARE_STATIC_FAB_ORGANIZATION_BUNDLE_PLACEMENT",
		requestId: permit.ticketId,
		ticketId: permit.ticketId,
		snapshot,
		bundle,
		expectedBundleFingerprint: staticFabOrganizationBundleFingerprint(bundle),
		anchor,
		quarterTurns: 0,
	});
	if (!prepared.valid || !prepared.plan || !prepared.ticket) {
		throw new Error(prepared.reason);
	}
	const workerPlan = structuredClone(prepared.plan);
	const workerTicket = structuredClone(prepared.ticket);
	const adopted = adoptStaticFabOrganizationBundlePlacementWorkerPlan(
		permit,
		workerPlan,
		workerTicket,
		workerTicket.prospectiveChecksum,
		document.map,
		document.portEquipment,
		document.organizations,
	);
	if (!adopted) throw new Error("Worker plan adoption failed.");
	return adopted;
}
