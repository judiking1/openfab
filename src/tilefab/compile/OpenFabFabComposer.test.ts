import { beforeAll, describe, expect, it } from "vitest";
import {
	type CertifiedOpenFabFabComposition,
	composeOpenFabFab,
	OPENFAB_FAB_COMPOSER_VERSION,
	openFabFabCompositionFingerprint,
	validateOpenFabFabCompositionCertificate,
} from "./OpenFabFabComposer";
import {
	defaultOpenFabFabProfile,
	OPENFAB_FAB_PROFILE_V1_POLICIES,
	type OpenFabFabProfile,
} from "./OpenFabFabProfile";

const MINIMUM_PROFILE = Object.freeze({
	kind: "openfab-fab-profile",
	version: 1,
	layoutBlockCount: 1,
	bankRepetitionAxis: "EAST_WEST",
	banksPerLayoutBlock: 1,
	processLoopsPerBank: 12,
	bayPackingPolicy: "TWIN",
	processLoopLongAxisMeters: 36,
	processLoopCenterPitchMeters: 12,
	...OPENFAB_FAB_PROFILE_V1_POLICIES,
}) satisfies OpenFabFabProfile;

const MAXIMUM_PROFILE = Object.freeze({
	kind: "openfab-fab-profile",
	version: 1,
	layoutBlockCount: 3,
	bankRepetitionAxis: "EAST_WEST",
	banksPerLayoutBlock: 3,
	processLoopsPerBank: 24,
	bayPackingPolicy: "SINGLE",
	processLoopLongAxisMeters: 56,
	processLoopCenterPitchMeters: 16,
	...OPENFAB_FAB_PROFILE_V1_POLICIES,
}) satisfies OpenFabFabProfile;

describe("OpenFabFabComposer", () => {
	let eastWest: CertifiedOpenFabFabComposition;
	let northSouth: CertifiedOpenFabFabComposition;

	beforeAll(() => {
		eastWest = composeOpenFabFab(defaultOpenFabFabProfile());
		northSouth = composeOpenFabFab({
			...defaultOpenFabFabProfile(),
			bankRepetitionAxis: "NORTH_SOUTH",
		});
	}, 120_000);

	it("composes and certifies the exact default Fab on both supported axes", () => {
		for (const certificate of [eastWest, northSouth]) {
			expect(certificate).toMatchObject({
				valid: true,
				kind: "certified-openfab-fab-composition",
				version: OPENFAB_FAB_COMPOSER_VERSION,
				placementReady: false,
				simulationReady: false,
				persistenceReady: true,
				createProjectReady: true,
				authored: {
					status: "closed",
					cells: 11_282,
					directedEdges: 11_432,
					components: 1,
					strongComponents: 1,
					stronglyConnected: true,
					openEnds: 0,
					unsafeJunctions: 0,
					junctions: 300,
				},
				physical: {
					valid: true,
					paths: 11_478,
					strongComponents: 1,
					stronglyConnected: true,
					openPaths: 0,
					invalidPaths: 0,
					diagnosticCount: 0,
					terminalCount: 0,
					clearanceIssueCount: 0,
				},
				readiness: { status: "ready", ready: true, issueCodes: [] },
				actionCapacity: {
					exactDirectedEdges: 11_432,
					exactOrganizations: 63,
					createProject: { ready: true, eligibility: "ELIGIBLE" },
					portablePlacement: { eligible: true, eligibility: "ELIGIBLE" },
				},
			});
			expect(certificate.edgeClaims).toHaveLength(11_432);
			expect(certificate.organizations.manifest.counts).toEqual({
				fabs: 1,
				banks: 2,
				bays: 24,
				processLoops: 36,
				organizationRecords: 63,
			});
			expect(validateOpenFabFabCompositionCertificate(certificate)).toBeNull();
			expect(openFabFabCompositionFingerprint(certificate)).toBe(certificate.fingerprint);
		}
		expect(northSouth.authored.cells).toBe(eastWest.authored.cells);
		expect(northSouth.authored.directedEdges).toBe(eastWest.authored.directedEdges);
		expect(northSouth.physical.paths).toBe(eastWest.physical.paths);
		expect(northSouth.fingerprint).not.toBe(eastWest.fingerprint);
	});

	it("publishes dependency-ordered mutation provenance with exact owned and reused edges", () => {
		const phaseOrder = [
			"perimeter-lane",
			"perimeter-turnback",
			"bank-collector",
			"bay-build-step",
			"bay-parent-gateway",
			"bank-parent-gateway",
			"inter-block-bridge",
		] as const;
		const phaseOrdinal = new Map(phaseOrder.map((kind, index) => [kind, index]));
		let lastPhase = -1;
		for (const step of eastWest.steps) {
			const phase = phaseOrdinal.get(step.kind);
			if (phase === undefined) throw new Error(`Unexpected step kind ${step.kind}.`);
			expect(phase).toBeGreaterThanOrEqual(lastPhase);
			lastPhase = phase;
			expect(step.expectedDirectedEdges).toBe(step.addedDirectedEdges);
			expect(step.claimCount).toBe(step.addedDirectedEdges);
			expect(
				eastWest.edgeClaims.slice(step.claimOffset, step.claimOffset + step.claimCount),
			).toHaveLength(step.claimCount);
		}
		expect(eastWest.steps.reduce((total, step) => total + step.addedDirectedEdges, 0)).toBe(11_432);

		const bankLinks = eastWest.steps.filter((step) => step.kind === "bank-parent-gateway");
		expect(bankLinks).toHaveLength(4);
		for (let index = 0; index < bankLinks.length; index += 2) {
			const pair = bankLinks.slice(index, index + 2);
			expect(new Set(pair.map((step) => step.sourcePlanFingerprint))).toHaveLength(1);
			expect(pair.reduce((total, step) => total + step.addedDirectedEdges, 0)).toBe(72);
			expect(pair.reduce((total, step) => total + step.reusedDirectedEdges, 0)).toBe(32);
			expect(new Set(pair.map((step) => step.ownerKey))).toHaveLength(1);
		}
	});

	it("roundtrips through the codec and exposes only a canonical source snapshot", () => {
		const snapshot = eastWest.roundTrippedSnapshot;
		expect(snapshot.sequence).toBe(0);
		expect(snapshot.revision).toBe(eastWest.authored.revision);
		expect(snapshot.encoded).toHaveLength(eastWest.authored.cells);
		expect(snapshot.organizations.organizationIds).toHaveLength(63);
		expect(eastWest.persistenceEvidence).toMatchObject({
			ready: true,
			internalManifestContract: "DETERMINISTIC_CERTIFICATION_TEMPLATE_V1",
			snapshotIdentity: {
				sequence: 0,
				revision: eastWest.authored.revision,
				nextAdvancedSwitchId: 1,
				nextPortId: 1,
				nextEquipmentGroupId: 1,
				nextOrganizationId: 64,
				railCells: eastWest.authored.cells,
				directedEdges: 11_432,
				advancedSwitches: 0,
				ports: 0,
				equipmentGroups: 0,
				organizations: 63,
			},
			organizationSectionEqual: true,
		});
		expect(eastWest.persistenceEvidence.roundTripSnapshotChecksum).toBe(eastWest.authored.checksum);
	});

	it("certifies minimum and maximum supported capacity boundaries", () => {
		const minimum = composeOpenFabFab(MINIMUM_PROFILE);
		expect(minimum.authored).toMatchObject({
			cells: 3_592,
			directedEdges: 3_632,
			junctions: 80,
		});
		expect(minimum.physical.paths).toBe(3_656);
		expect(minimum.organizations.manifest.counts).toMatchObject({
			fabs: 1,
			banks: 1,
			bays: 6,
			processLoops: 12,
			organizationRecords: 20,
		});
		expect(minimum.actionCapacity.portablePlacement).toMatchObject({
			eligible: true,
			eligibility: "ELIGIBLE",
		});
		expect(validateOpenFabFabCompositionCertificate(minimum)).toBeNull();

		const maximum = composeOpenFabFab(MAXIMUM_PROFILE);
		expect(maximum.authored.directedEdges).toBe(83_020);
		expect(maximum.assemblyPlan.capacity).toMatchObject({
			primitiveDirectedEdges: 82_116,
			upperLinkDirectedEdges: 904,
			plannedDirectedEdges: 83_020,
		});
		expect(maximum.organizations.manifest.counts).toEqual({
			fabs: 1,
			banks: 9,
			bays: 216,
			processLoops: 216,
			organizationRecords: 442,
		});
		expect(maximum.authored).toMatchObject({
			status: "closed",
			cells: 81_696,
			directedEdges: 83_020,
			components: 1,
			strongComponents: 1,
			openEnds: 0,
			unsafeJunctions: 0,
			junctions: 2_648,
		});
		expect(maximum.physical).toMatchObject({
			valid: true,
			paths: 83_876,
			strongComponents: 1,
			openPaths: 0,
			invalidPaths: 0,
			diagnosticCount: 0,
			terminalCount: 0,
			clearanceIssueCount: 0,
		});
		expect(maximum.persistenceEvidence.ready).toBe(true);
		expect(maximum.actionCapacity).toMatchObject({
			exactDirectedEdges: 83_020,
			exactOrganizations: 442,
			createProject: { ready: true, eligibility: "ELIGIBLE" },
			portablePlacement: {
				eligible: false,
				eligibility: "PLACEMENT_EDGE_LIMIT",
				directedEdgeHeadroom: 0,
			},
		});
		const bridges = maximum.steps.filter((step) => step.kind === "inter-block-bridge");
		expect(bridges).toHaveLength(4);
		for (let index = 0; index < bridges.length; index += 2) {
			const pair = bridges.slice(index, index + 2);
			expect(pair.reduce((total, step) => total + step.addedDirectedEdges, 0)).toBe(128);
			expect(pair.reduce((total, step) => total + step.reusedDirectedEdges, 0)).toBe(32);
			expect(new Set(pair.map((step) => step.ownerKey))).toEqual(new Set(["fab-1"]));
		}
	}, 120_000);

	it("rejects invalid input and fails closed on copied or tampered evidence", () => {
		expect(() => composeOpenFabFab({})).toThrowError(RangeError);
		const firstBlock = eastWest.assemblyPlan.layoutBlocks[0];
		const firstTurnback = firstBlock?.perimeterTurnbackRoutes[0];
		if (!firstBlock || !firstTurnback) throw new Error("Expected default perimeter evidence.");
		const tamperedTurnback = Object.freeze([
			Object.freeze({
				x: (firstTurnback[0]?.x ?? 0) + 1,
				y: firstTurnback[0]?.y ?? 0,
			}),
			...firstTurnback.slice(1),
		]);
		expect(
			validateOpenFabFabCompositionCertificate(
				Object.freeze({
					...eastWest,
					assemblyPlan: Object.freeze({
						...eastWest.assemblyPlan,
						layoutBlocks: Object.freeze([
							Object.freeze({
								...firstBlock,
								perimeterTurnbackRoutes: Object.freeze([
									tamperedTurnback,
									firstBlock.perimeterTurnbackRoutes[1],
								]),
							}),
							...eastWest.assemblyPlan.layoutBlocks.slice(1),
						]),
					}),
				}),
			),
		).toMatch(/canonical plan/);
		expect(
			validateOpenFabFabCompositionCertificate(
				Object.freeze({ ...eastWest, fingerprint: "openfab-fab-composition:v1:tampered" }),
			),
		).toMatch(/fingerprint/);
		expect(
			validateOpenFabFabCompositionCertificate(
				Object.freeze({ ...eastWest, edgeClaims: Object.freeze(eastWest.edgeClaims.slice(1)) }),
			),
		).toMatch(/edge claims|directed-edge counts/i);
		expect(
			validateOpenFabFabCompositionCertificate(
				Object.freeze({
					...eastWest,
					persistenceEvidence: Object.freeze({
						...eastWest.persistenceEvidence,
						snapshotIdentity: Object.freeze({
							...eastWest.persistenceEvidence.snapshotIdentity,
							revision: eastWest.persistenceEvidence.snapshotIdentity.revision + 1,
						}),
					}),
				}),
			),
		).toMatch(/persistence/);
		expect(Object.isFrozen(eastWest)).toBe(true);
		expect(Object.isFrozen(eastWest.steps)).toBe(true);
		expect(Object.isFrozen(eastWest.edgeClaims)).toBe(true);
		expect(Object.isFrozen(eastWest.persistenceEvidence.snapshotIdentity)).toBe(true);
	});
});
