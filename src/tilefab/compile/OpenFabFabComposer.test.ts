import { beforeAll, describe, expect, it } from "vitest";
import { RailDocument, type RailPatchEvent } from "../core/RailDocument";
import {
	emptyStaticFabAssemblyRelationshipState,
	staticFabAssemblyRelationshipStateShapeError,
	staticFabAssemblyRelationshipStateSourceError,
} from "../core/StaticFabAssemblyRelationship";
import {
	adoptStaticFabSemanticBankDeleteWorkerPlan,
	issueStaticFabSemanticBankDeletePermit,
	staticFabSemanticBankDeleteIntentFingerprint,
	staticFabSemanticBankDeleteSourceIdentity,
} from "../core/StaticFabSemanticBankDeleteCertification";
import {
	planStaticFabSemanticBankDetach,
	reviewStaticFabSemanticBankDetachCut,
} from "../core/StaticFabSemanticBankDetach";
import {
	adoptStaticFabSemanticBankDetachWorkerPlan,
	issueStaticFabSemanticBankDetachPermit,
	staticFabSemanticBankDetachIntentFingerprint,
	staticFabSemanticBankDetachSourceIdentity,
} from "../core/StaticFabSemanticBankDetachCertification";
import {
	captureOpenFabProject,
	createOpenFabProjectManifest,
	createRailSnapshotFromOpenFabProject,
} from "../project/OpenFabProject";
import { parseOpenFabProjectJson, serializeOpenFabProject } from "../project/OpenFabProjectCodec";
import {
	captureRailMirrorSnapshot,
	checksumRailMap,
	checksumRailPatchResult,
} from "../worker/RailMirrorChecksum";
import { hydrateRailMirrorSnapshotDocument } from "../worker/RailMirrorSnapshotDocument";
import { RailPatchMirror } from "../worker/RailPatchMirror";
import { decodeRailPatchSoA, encodeRailPatchEvent } from "../worker/railMirrorProtocol";
import { staticFabSemanticBankDeletePreparedShapeError } from "../worker/StaticFabSemanticBankDeleteResponseValidator";
import { prepareStaticFabSemanticBankDelete } from "../worker/StaticFabSemanticBankDeleteRuntime";
import { staticFabSemanticBankDetachPreparedShapeError } from "../worker/StaticFabSemanticBankDetachResponseValidator";
import { prepareStaticFabSemanticBankDetach } from "../worker/StaticFabSemanticBankDetachRuntime";
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

	it.each([
		["EAST_WEST", "DETACH"],
		["NORTH_SOUTH", "DETACH"],
		["EAST_WEST", "DELETE"],
		["NORTH_SOUTH", "DELETE"],
	] as const)("reopens generated %s Fab and performs end Bank %s with atomic Mirror Undo/Redo", (axis, action) => {
		const certificate = axis === "EAST_WEST" ? eastWest : northSouth;
		const original = hydrateRailMirrorSnapshotDocument(certificate.roundTrippedSnapshot);
		const saved = serializeOpenFabProject(
			captureOpenFabProject(original, {
				manifest: createOpenFabProjectManifest(
					"synthetic-generated-edit",
					"Generated Bank edit",
					"2026-10-06T00:00:00.000Z",
				),
			}),
		);
		const parsed = parseOpenFabProjectJson(saved);
		expect(parsed.project.schemaVersion).toBe(16);
		const document = hydrateRailMirrorSnapshotDocument(
			createRailSnapshotFromOpenFabProject(parsed.project),
		);
		expect(document.relationships).toEqual(original.relationships);
		expect(document.relationships.records).toHaveLength(2);
		const bank = document.organizations.records.find((row) => row.name === "Bay Bank 2");
		if (!bank) throw new Error("Expected generated end Bank");
		const intent = {
			version: 1,
			action: "DETACH",
			targetRole: "BAY_BANK",
			targetOrganizationId: bank.id,
			expectedParentOrganizationId: 1,
		} as const;
		const scope = { projectId: "synthetic-generated-edit", projectGeneration: 1 };
		const snapshot = captureRailMirrorSnapshot(
			document.map,
			document.getPatchSequence(),
			document.portEquipment,
			document.organizations,
			document.relationships,
		).snapshot;
		const events: RailPatchEvent[] = [];
		document.subscribe((event) => events.push(event));
		const mirror = new RailPatchMirror();
		mirror.sync(snapshot);
		let expectedChecksum: string;
		if (action === "DETACH") {
			const permit = issueStaticFabSemanticBankDetachPermit(
				document,
				scope,
				intent,
				snapshot.checksum,
			);
			const prepared = structuredClone(
				prepareStaticFabSemanticBankDetach({
					type: "PREPARE_STATIC_FAB_SEMANTIC_BANK_DETACH",
					version: 1,
					requestId: 1,
					ticketId: permit.ticketId,
					snapshot,
					intent,
					expectedSource: staticFabSemanticBankDetachSourceIdentity(document, snapshot.checksum),
					expectedIntentFingerprint: staticFabSemanticBankDetachIntentFingerprint(intent),
				}),
			);
			expect(prepared.valid, prepared.reason).toBe(true);
			expect(staticFabSemanticBankDetachPreparedShapeError(prepared)).toBeNull();
			if (!prepared.plan || !prepared.ticket) throw new Error(prepared.reason);
			expectedChecksum = prepared.ticket.prospective.checksum;
			expect(prepared.review?.removedDirectedEdgeCount).toBe(72);
			expect(prepared.review?.removedRailModuleCount).toBe(22);
			const plan = adoptStaticFabSemanticBankDetachWorkerPlan(
				permit,
				prepared.ticket,
				prepared.plan,
				document,
				scope,
				intent,
				checksumRailPatchResult(snapshot.checksum, prepared.plan.transition),
			);
			expect(
				document.commitStaticFabSemanticBankDetach(plan, scope),
				document.getLastCommandError() ?? "",
			).toBe(true);
			expect(document.organizations.records.find((row) => row.id === bank.id)?.membership).toEqual(
				bank.membership,
			);
			expect(
				document.organizations.records.filter((row) => row.id !== 1 && row.id !== bank.id),
			).toEqual(original.organizations.records.filter((row) => row.id !== 1 && row.id !== bank.id));
			expect(document.portEquipment).toEqual(original.portEquipment);
		} else {
			const deleteIntent = { ...intent, action: "DELETE" } as const;
			const permit = issueStaticFabSemanticBankDeletePermit(
				document,
				scope,
				deleteIntent,
				snapshot.checksum,
			);
			const prepared = structuredClone(
				prepareStaticFabSemanticBankDelete({
					type: "PREPARE_STATIC_FAB_SEMANTIC_BANK_DELETE",
					version: 1,
					requestId: 1,
					ticketId: permit.ticketId,
					snapshot,
					operationalConfiguration: document.operationalConfiguration,
					intent: deleteIntent,
					expectedSource: staticFabSemanticBankDeleteSourceIdentity(document, snapshot.checksum),
					expectedIntentFingerprint: staticFabSemanticBankDeleteIntentFingerprint(deleteIntent),
				}),
			);
			expect(prepared.valid, prepared.reason).toBe(true);
			expect(staticFabSemanticBankDeletePreparedShapeError(prepared)).toBeNull();
			if (!prepared.plan || !prepared.ticket) throw new Error(prepared.reason);
			expectedChecksum = prepared.ticket.prospective.checksum;
			const plan = adoptStaticFabSemanticBankDeleteWorkerPlan(
				permit,
				prepared.ticket,
				prepared.plan,
				document,
				scope,
				deleteIntent,
				checksumRailPatchResult(snapshot.checksum, prepared.plan.transition),
			);
			expect(
				document.commitStaticFabSemanticBankDelete(plan, scope),
				document.getLastCommandError() ?? "",
			).toBe(true);
			expect(document.organizations.records.some((row) => row.id === bank.id)).toBe(false);
			expect(prepared.review?.removed.organizations.count).toBe(31);
		}
		expect(events).toHaveLength(1);
		expect(document.relationships.records.map((row) => row.id)).toEqual([1]);
		expect(document.relationships.nextRelationshipId).toBe(
			original.relationships.nextRelationshipId,
		);
		expect(document.organizations.nextOrganizationId).toBe(
			original.organizations.nextOrganizationId,
		);
		const apply = () => {
			const event = events.at(-1);
			if (!event) throw new Error("Expected patch");
			return mirror.applyPatch(decodeRailPatchSoA(encodeRailPatchEvent(event).patch));
		};
		expect(apply().checksum).toBe(expectedChecksum);
		expect(document.undo(), document.getLastCommandError() ?? "").toBe(true);
		expect(apply().checksum).toBe(snapshot.checksum);
		expect(document.organizations).toEqual(original.organizations);
		expect(document.relationships).toEqual(original.relationships);
		expect(document.redo(), document.getLastCommandError() ?? "").toBe(true);
		expect(apply().checksum).toBe(expectedChecksum);
		expect(
			checksumRailMap(
				document.map,
				document.portEquipment,
				document.organizations,
				document.relationships,
			),
		).toBe(expectedChecksum);
	});
	it("keeps a v15 relationship-free project unmanaged and rejects a changed declared seam", () => {
		const generated = hydrateRailMirrorSnapshotDocument(eastWest.roundTrippedSnapshot);
		const legacy = RailDocument.fromLoadedMap(
			generated.map,
			0,
			generated.portEquipment,
			generated.organizations,
			undefined,
			emptyStaticFabAssemblyRelationshipState(),
		);
		const source = captureOpenFabProject(legacy, {
			manifest: createOpenFabProjectManifest(
				"synthetic-legacy",
				"Legacy unmanaged",
				"2026-10-06T00:00:00.000Z",
			),
		});
		const parsed = parseOpenFabProjectJson(JSON.stringify({ ...source, schemaVersion: 15 }));
		expect(parsed.migratedFromVersion).toBe(15);
		expect(parsed.project.areas).toEqual(source.areas);
		const reopened = hydrateRailMirrorSnapshotDocument(
			createRailSnapshotFromOpenFabProject(parsed.project),
		);
		expect(reopened.relationships).toEqual(emptyStaticFabAssemblyRelationshipState());
		const intent = {
			version: 1,
			action: "DETACH",
			targetRole: "BAY_BANK",
			targetOrganizationId: 33,
			expectedParentOrganizationId: 1,
		} as const;
		expect(
			planStaticFabSemanticBankDetach(
				reopened.map,
				reopened.portEquipment,
				0,
				reopened.organizations,
				reopened.relationships,
				intent,
			).issueCode,
		).toBe("RELATIONSHIP_MISSING");
		const changed = structuredClone(generated.relationships);
		const witness = changed.records[1]?.connectionGroups[0]?.legs[0]?.endpointSupports[0]?.support;
		if (!witness) throw new Error("Expected exact support");
		Object.assign(witness.edge.from, { x: witness.edge.from.x + 1 });
		expect(
			staticFabAssemblyRelationshipStateSourceError(
				generated.map,
				generated.organizations,
				changed,
			),
		).not.toBeNull();
		expect(
			planStaticFabSemanticBankDetach(
				generated.map,
				generated.portEquipment,
				0,
				generated.organizations,
				changed,
				intent,
			).valid,
		).toBe(false);
	});

	it("enforces the existing source budget before inspecting a declared attachment", () => {
		const document = hydrateRailMirrorSnapshotDocument(eastWest.roundTrippedSnapshot);
		expect(
			reviewStaticFabSemanticBankDetachCut(
				document.map,
				{ ...document.portEquipment, ports: new Array(100_001) },
				document.organizations,
				{
					version: 1,
					action: "DETACH",
					targetRole: "BAY_BANK",
					targetOrganizationId: 33,
					expectedParentOrganizationId: 1,
				},
				document.relationships,
			),
		).toMatchObject({
			structuralCutProved: false,
			issueCode: "BOUNDARY_INVENTORY_REJECTED",
			reason: expect.stringContaining("Port source"),
		});
	});

	it("rejects a single attachment whose two endpoints both claim only the parent", () => {
		const document = hydrateRailMirrorSnapshotDocument(eastWest.roundTrippedSnapshot);
		const relationships = structuredClone(document.relationships);
		const leg = relationships.records[0]?.connectionGroups[0]?.legs[0];
		if (!leg) throw new Error("Expected one declared attachment");
		for (const seam of leg.seamContacts)
			for (const incidence of seam.incidences)
				if (incidence.binding.kind === "WITNESS")
					Object.assign(incidence.binding.scopedEdge, { scope: { kind: "PARENT_DIRECT" } });
		for (const support of leg.endpointSupports)
			Object.assign(support.support, { scope: { kind: "PARENT_DIRECT" } });
		expect(staticFabAssemblyRelationshipStateShapeError(relationships)).toMatch(/단일 attachment/);
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
