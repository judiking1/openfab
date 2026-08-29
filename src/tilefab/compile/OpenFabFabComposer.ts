import { emptyPortEquipmentState } from "../core/EquipmentGroup";
import {
	analyzeRailNetwork,
	checksumRailNetworkAnalysis,
	type RailNetworkAnalysis,
} from "../core/network";
import { OrderedTypedChecksum } from "../core/OrderedTypedChecksum";
import type { ProductionBayBuildStepOwner } from "../core/ProductionBayModulePlanner";
import type { DirectedRailEdge } from "../core/RailModuleOwnership";
import { planRailRouteBatch } from "../core/RailTemplateCatalog";
import { ALL_DIRECTIONS, bitCount, directionBetween, moveCell } from "../core/railShape";
import {
	compareDirectedRailEdges,
	staticFabOrganizationEdgeKey,
} from "../core/StaticFabOrganization";
import {
	STATIC_FAB_ORGANIZATION_BUNDLE_MAX_ORGANIZATIONS,
	STATIC_FAB_ORGANIZATION_BUNDLE_MAX_RAIL_EDGES,
} from "../core/StaticFabOrganizationBundle";
import { type Cell, decodeRailCell, TileMap, type TileMapCellMutation } from "../core/TileMap";
import {
	captureOpenFabProjectFromRailSnapshot,
	createOpenFabProjectManifest,
	createRailSnapshotFromOpenFabProject,
	OPENFAB_PROJECT_SCHEMA_VERSION,
} from "../project/OpenFabProject";
import { parseOpenFabProjectJson, serializeOpenFabProject } from "../project/OpenFabProjectCodec";
import { captureOpenFabProjectOrganizationSection } from "../project/OpenFabProjectOrganizations";
import {
	captureRailMirrorSnapshot,
	checksumRailMirrorSnapshot,
	type RailMirrorSnapshot,
} from "../worker/RailMirrorChecksum";
import { hydrateRailMirrorSnapshotDocument } from "../worker/RailMirrorSnapshotDocument";
import { checksumRailPhysicalLayout } from "../worker/RailPhysicalLayout";
import {
	createOpenFabFabAssemblyPlan,
	type OpenFabFabAssemblyPlan,
	validateOpenFabFabAssemblyPlan,
} from "./OpenFabFabAssemblyPlan";
import type { OpenFabFabInterBlockBridgePlan } from "./OpenFabFabInterBlockBridgePlanner";
import {
	type CertifiedOpenFabFabOrganizations,
	compileOpenFabFabOrganizations,
	OPENFAB_FAB_ORGANIZATION_ROOT_KEY,
	openFabFabOrganizationCertificationFingerprint,
	openFabFabOrganizationEdgeClaimFingerprint,
} from "./OpenFabFabOrganizationCompiler";
import type { OpenFabFabProfile } from "./OpenFabFabProfile";
import { analyzePhysicalPathTopology } from "./PhysicalPathTopology";
import { compilePhysicalRail } from "./PhysicalRailCompiler";
import type { ProductionBankParentGatewayPlan } from "./ProductionBankParentGatewayPlanner";
import type { ProductionBayParentGatewayPlan } from "./ProductionBayParentGatewayPlanner";
import { checksumRailProjectReadiness, createRailProjectReadiness } from "./RailProjectReadiness";
import type { StaticFabOrganizationDirectedEdgeClaim } from "./StaticFabOrganizationSeedCompiler";

export const OPENFAB_FAB_COMPOSER_VERSION = 1 as const;
const OPENFAB_FAB_COMPOSER_INTERNAL_PROJECT_CREATED_AT = "1970-01-01T00:00:00.000Z" as const;
const OPENFAB_FAB_COMPOSER_INTERNAL_PROJECT_NAME =
	"OpenFab Fab Composition Certification Template" as const;

export type OpenFabFabCompositionStepKind =
	| "perimeter-lane"
	| "perimeter-turnback"
	| "bank-collector"
	| "bay-build-step"
	| "bay-parent-gateway"
	| "bank-parent-gateway"
	| "inter-block-bridge";

export type OpenFabFabCompositionPlacement = "connected" | "free-closed-primary";

export interface OpenFabFabCompositionStep {
	readonly ordinal: number;
	readonly batchOrdinal: number;
	readonly id: string;
	readonly kind: OpenFabFabCompositionStepKind;
	readonly ownerKey: string;
	readonly sourcePlanFingerprint: string;
	readonly placement: OpenFabFabCompositionPlacement;
	readonly expectedDirectedEdges: number;
	readonly addedDirectedEdges: number;
	/** Directed support-edge references already owned by an earlier dependency step. */
	readonly reusedDirectedEdges: number;
	readonly claimOffset: number;
	readonly claimCount: number;
	readonly edgeFingerprint: string;
}

export interface OpenFabFabCompositionChildLinks {
	readonly bayParentGateways: readonly ProductionBayParentGatewayPlan[];
	readonly bankParentGateways: readonly ProductionBankParentGatewayPlan[];
	readonly interBlockBridges: readonly OpenFabFabInterBlockBridgePlan[];
	readonly fingerprint: string;
}

export interface OpenFabFabAuthoredCertificate {
	readonly status: "closed";
	readonly revision: number;
	readonly cells: number;
	readonly directedEdges: number;
	readonly components: 1;
	readonly strongComponents: 1;
	readonly stronglyConnected: true;
	readonly openEnds: 0;
	readonly unsafeJunctions: 0;
	readonly junctions: number;
	readonly checksum: string;
	readonly topologyFingerprint: string;
	readonly fingerprint: string;
}

export interface OpenFabFabPhysicalCertificate {
	readonly valid: true;
	readonly paths: number;
	readonly strongComponents: 1;
	readonly stronglyConnected: true;
	readonly openPaths: 0;
	readonly invalidPaths: 0;
	readonly diagnosticCount: 0;
	readonly terminalCount: 0;
	readonly clearanceIssueCount: 0;
	/** Exact Worker physical-layout identity over all compiled buffers. */
	readonly layoutFingerprint: string;
	readonly fingerprint: string;
}

export interface OpenFabFabReadinessCertificate {
	readonly status: "ready";
	readonly ready: true;
	readonly issueCodes: readonly [];
	readonly authoredChecksum: string;
	readonly topologyFingerprint: string;
	readonly reportFingerprint: string;
	readonly fingerprint: string;
}

export interface OpenFabFabPersistenceEvidence {
	readonly ready: true;
	readonly schemaVersion: typeof OPENFAB_PROJECT_SCHEMA_VERSION;
	readonly internalManifestContract: "DETERMINISTIC_CERTIFICATION_TEMPLATE_V1";
	readonly serializedCharacters: number;
	readonly canonicalJsonFingerprint: string;
	readonly sourceSnapshotChecksum: string;
	readonly roundTripSnapshotChecksum: string;
	readonly snapshotIdentity: OpenFabFabRoundTrippedSnapshotIdentity;
	readonly organizationSectionEqual: true;
	readonly fingerprint: string;
}

export interface OpenFabFabRoundTrippedSnapshotIdentity {
	readonly sequence: 0;
	readonly revision: number;
	readonly nextAdvancedSwitchId: number;
	readonly nextPortId: number;
	readonly nextEquipmentGroupId: number;
	readonly nextOrganizationId: number;
	readonly railCells: number;
	readonly directedEdges: number;
	readonly advancedSwitches: number;
	readonly ports: number;
	readonly equipmentGroups: number;
	readonly organizations: number;
	readonly checksum: string;
	readonly fingerprint: string;
}

export type OpenFabFabPortablePlacementEligibility =
	| "ELIGIBLE"
	| "PLACEMENT_EDGE_LIMIT"
	| "PLACEMENT_ORGANIZATION_LIMIT";

export interface OpenFabFabCompositionActionCapacity {
	readonly exactDirectedEdges: number;
	readonly exactOrganizations: number;
	readonly createProject: Readonly<{
		ready: true;
		eligibility: "ELIGIBLE";
	}>;
	readonly portablePlacement: Readonly<{
		eligible: boolean;
		eligibility: OpenFabFabPortablePlacementEligibility;
		directedEdgeLimit: typeof STATIC_FAB_ORGANIZATION_BUNDLE_MAX_RAIL_EDGES;
		organizationLimit: typeof STATIC_FAB_ORGANIZATION_BUNDLE_MAX_ORGANIZATIONS;
		directedEdgeHeadroom: number;
		organizationHeadroom: number;
	}>;
	readonly fingerprint: string;
}

export interface CertifiedOpenFabFabComposition {
	readonly valid: true;
	readonly kind: "certified-openfab-fab-composition";
	readonly version: typeof OPENFAB_FAB_COMPOSER_VERSION;
	/** False means no Place-action artifact has been created. */
	readonly placementReady: false;
	/** Static-authoring readiness never opens the simulation product gate. */
	readonly simulationReady: false;
	readonly persistenceReady: true;
	readonly createProjectReady: true;
	readonly profile: OpenFabFabProfile;
	readonly assemblyPlan: OpenFabFabAssemblyPlan;
	readonly childLinks: OpenFabFabCompositionChildLinks;
	readonly steps: readonly OpenFabFabCompositionStep[];
	readonly stepLedgerFingerprint: string;
	readonly edgeClaims: readonly StaticFabOrganizationDirectedEdgeClaim[];
	readonly organizations: CertifiedOpenFabFabOrganizations;
	readonly authored: OpenFabFabAuthoredCertificate;
	readonly physical: OpenFabFabPhysicalCertificate;
	readonly readiness: OpenFabFabReadinessCertificate;
	/** Canonical one-shot source for the later New Project Worker; it is not a Place artifact. */
	readonly roundTrippedSnapshot: RailMirrorSnapshot;
	readonly persistenceEvidence: OpenFabFabPersistenceEvidence;
	readonly actionCapacity: OpenFabFabCompositionActionCapacity;
	readonly fingerprint: string;
}

interface PendingCompositionStep {
	readonly id: string;
	readonly kind: OpenFabFabCompositionStepKind;
	readonly ownerKey: string;
	readonly sourcePlanFingerprint: string;
	readonly planningRoute: readonly Cell[];
	readonly ownedDirectedEdges: readonly DirectedRailEdge[];
}

interface CompositionLedger {
	batchOrdinal: number;
	readonly claimOwnerByEdgeKey: Map<string, string>;
	readonly claims: StaticFabOrganizationDirectedEdgeClaim[];
	readonly steps: OpenFabFabCompositionStep[];
}

/**
 * Materialize and certify one complete Fab from versioned public profile intent. Every claim comes
 * from the exact prospective TileMap delta and is checked against its geometry planner's ownership
 * contract before the mutation is published to the fresh map.
 */
export function composeOpenFabFab(input: unknown): CertifiedOpenFabFabComposition {
	const assemblyPlan = createOpenFabFabAssemblyPlan(input);
	const map = new TileMap();
	const ledger: CompositionLedger = {
		batchOrdinal: 0,
		claimOwnerByEdgeKey: new Map(),
		claims: [],
		steps: [],
	};

	for (const block of assemblyPlan.layoutBlocks) {
		for (let laneIndex = 0; laneIndex < block.perimeter.lanes.length; laneIndex += 1) {
			const lane = block.perimeter.lanes[laneIndex];
			const route = block.perimeter.buildRoutes[laneIndex];
			if (!lane || !route) throw new Error(`Missing perimeter lane ${laneIndex} for ${block.key}.`);
			commitCompositionBatch(map, ledger, "free-closed-primary", [
				{
					id: `${block.key}/perimeter/${lane.id}`,
					kind: "perimeter-lane",
					ownerKey: OPENFAB_FAB_ORGANIZATION_ROOT_KEY,
					sourcePlanFingerprint: block.perimeter.fingerprint,
					planningRoute: route,
					ownedDirectedEdges: directedEdgesForRoute(route),
				},
			]);
		}
	}

	for (const block of assemblyPlan.layoutBlocks) {
		for (
			let turnbackIndex = 0;
			turnbackIndex < block.perimeterTurnbackRoutes.length;
			turnbackIndex += 1
		) {
			const descriptor = block.perimeter.turnbacks[turnbackIndex];
			const route = block.perimeterTurnbackRoutes[turnbackIndex];
			if (!descriptor || !route) {
				throw new Error(`Missing perimeter turnback ${turnbackIndex} for ${block.key}.`);
			}
			commitCompositionBatch(map, ledger, "connected", [
				{
					id: `${block.key}/perimeter-turnback/${descriptor.id}`,
					kind: "perimeter-turnback",
					ownerKey: OPENFAB_FAB_ORGANIZATION_ROOT_KEY,
					sourcePlanFingerprint: block.perimeter.fingerprint,
					planningRoute: route,
					ownedDirectedEdges: directedEdgesForRoute(route),
				},
			]);
		}
	}

	for (const block of assemblyPlan.layoutBlocks) {
		for (const bank of block.banks) {
			commitCompositionBatch(map, ledger, "free-closed-primary", [
				{
					id: `${bank.key}/collector`,
					kind: "bank-collector",
					ownerKey: bank.organizationKey,
					sourcePlanFingerprint: bank.collector.fingerprint,
					planningRoute: bank.closedCollectorRoute,
					ownedDirectedEdges: directedEdgesForRoute(bank.closedCollectorRoute),
				},
			]);
		}
	}

	for (const block of assemblyPlan.layoutBlocks) {
		for (const bank of block.banks) {
			for (const bay of bank.bays) {
				commitCompositionBatch(
					map,
					ledger,
					"free-closed-primary",
					bay.plan.buildSteps.map((step) => ({
						id: `${bay.key}/build/${step.id}`,
						kind: "bay-build-step" as const,
						ownerKey: bayBuildStepOwnerKey(bay, step.owner),
						sourcePlanFingerprint: bay.plan.fingerprint,
						planningRoute: step.route,
						ownedDirectedEdges: directedEdgesForRoute(step.route),
					})),
				);
			}
		}
	}

	for (const block of assemblyPlan.layoutBlocks) {
		for (const bank of block.banks) {
			for (const bay of bank.bays) {
				commitCompositionBatch(
					map,
					ledger,
					"connected",
					bay.parentGateway.buildSteps.map((step) => ({
						id: `${bay.key}/parent-gateway/${step.id}`,
						kind: "bay-parent-gateway" as const,
						ownerKey: bank.organizationKey,
						sourcePlanFingerprint: bay.parentGateway.fingerprint,
						planningRoute: step.route,
						ownedDirectedEdges: step.ownedDirectedEdges,
					})),
				);
			}
		}
	}

	for (const block of assemblyPlan.layoutBlocks) {
		for (const bank of block.banks) {
			commitCompositionBatch(
				map,
				ledger,
				"connected",
				bank.parentGateway.buildSteps.map((step) => ({
					id: `${bank.key}/parent-gateway/${step.id}`,
					kind: "bank-parent-gateway" as const,
					ownerKey: bank.organizationKey,
					sourcePlanFingerprint: bank.parentGateway.fingerprint,
					planningRoute: step.route,
					ownedDirectedEdges: step.ownedDirectedEdges,
				})),
			);
		}
	}

	for (let bridgeIndex = 0; bridgeIndex < assemblyPlan.interBlockBridges.length; bridgeIndex += 1) {
		const bridge = assemblyPlan.interBlockBridges[bridgeIndex] as OpenFabFabInterBlockBridgePlan;
		commitCompositionBatch(
			map,
			ledger,
			"connected",
			bridge.connections.map((connection) => ({
				id: `inter-block-bridge-${bridgeIndex + 1}/${connection.id}`,
				kind: "inter-block-bridge" as const,
				ownerKey: connection.ownerKey,
				sourcePlanFingerprint: bridge.fingerprint,
				planningRoute: connection.planningRoute,
				ownedDirectedEdges: connection.ownedDirectedEdges,
			})),
		);
	}

	if (
		map.edgeCount !== assemblyPlan.capacity.plannedDirectedEdges ||
		ledger.claims.length !== map.edgeCount ||
		ledger.claimOwnerByEdgeKey.size !== map.edgeCount
	) {
		throw new Error(
			`OpenFab composition exact edge ledger mismatch: map=${map.edgeCount}, claims=${ledger.claims.length}, planned=${assemblyPlan.capacity.plannedDirectedEdges}.`,
		);
	}

	const childLinks = createChildLinkEvidence(assemblyPlan);
	const expectedCounts = assemblyPlan.profileDerived.counts;
	if (
		childLinks.bayParentGateways.length !== expectedCounts.requiredBayToBankGatewayPairs ||
		childLinks.bankParentGateways.length !== expectedCounts.requiredBankToDistributorGatewayPairs ||
		childLinks.interBlockBridges.length !== expectedCounts.requiredInterBlockConnectors
	) {
		throw new Error("OpenFab composition child-link counts do not match derived profile intent.");
	}

	const edgeClaims = Object.freeze([...ledger.claims]);
	const organizationsResult = compileOpenFabFabOrganizations(map, assemblyPlan, edgeClaims);
	if (!organizationsResult.valid) {
		throw new Error(`OpenFab organization certification failed: ${organizationsResult.reason}`);
	}
	const organizations = organizationsResult;
	if (organizations.compilation.edgeCount !== map.edgeCount) {
		throw new Error("OpenFab organization certification did not cover every authored edge.");
	}

	const analysis = analyzeRailNetwork(map);
	assertClosedAuthoredTopology(analysis);
	const physicalLayout = compilePhysicalRail(map);
	const physicalTopology = analyzePhysicalPathTopology(physicalLayout.paths);
	if (
		!physicalLayout.valid ||
		physicalLayout.diagnostics.length !== 0 ||
		physicalLayout.terminals.length !== 0 ||
		physicalLayout.clearance.issues.count !== 0 ||
		physicalTopology.invalidPaths !== 0 ||
		physicalTopology.openPaths !== 0 ||
		physicalTopology.strongComponents !== 1 ||
		!physicalTopology.stronglyConnected
	) {
		throw new Error(
			`OpenFab physical certification failed: valid=${physicalLayout.valid}, diagnostics=${physicalLayout.diagnostics.length}, terminals=${physicalLayout.terminals.length}, clearance=${physicalLayout.clearance.issues.count}, invalidPaths=${physicalTopology.invalidPaths}, openPaths=${physicalTopology.openPaths}, strongComponents=${physicalTopology.strongComponents}.`,
		);
	}

	const authoredChecksum = organizations.authoredChecksum;
	const readinessReport = createRailProjectReadiness(analysis, physicalLayout, authoredChecksum);
	if (
		!readinessReport.ready ||
		readinessReport.status !== "ready" ||
		readinessReport.issues.length !== 0
	) {
		throw new Error(
			`OpenFab readiness certification failed: ${readinessReport.issues.map((issue) => issue.code).join(", ") || readinessReport.status}.`,
		);
	}
	if (checksumRailProjectReadiness(readinessReport) !== readinessReport.fingerprint) {
		throw new Error("OpenFab readiness fingerprint does not match its evidence.");
	}

	const authored = createAuthoredCertificate(map, analysis, authoredChecksum);
	const physical = createPhysicalCertificate(physicalLayout, physicalTopology);
	const readiness = createReadinessCertificate(readinessReport);

	const persistence = createPersistenceEvidence(map, organizations);
	const actionCapacity = createActionCapacity(
		map.edgeCount,
		organizations.manifest.counts.organizationRecords,
	);
	const steps = Object.freeze([...ledger.steps]);
	const stepLedgerFingerprint = compositionStepLedgerFingerprint(steps);
	const withoutFingerprint = Object.freeze({
		valid: true as const,
		kind: "certified-openfab-fab-composition" as const,
		version: OPENFAB_FAB_COMPOSER_VERSION,
		placementReady: false as const,
		simulationReady: false as const,
		persistenceReady: true as const,
		createProjectReady: true as const,
		profile: assemblyPlan.profile,
		assemblyPlan,
		childLinks,
		steps,
		stepLedgerFingerprint,
		edgeClaims,
		organizations,
		authored,
		physical,
		readiness,
		roundTrippedSnapshot: persistence.snapshot,
		persistenceEvidence: persistence.evidence,
		actionCapacity,
	});
	return Object.freeze({
		...withoutFingerprint,
		fingerprint: openFabFabCompositionFingerprint(withoutFingerprint),
	});
}

export function openFabFabCompositionFingerprint(
	certificate: Omit<CertifiedOpenFabFabComposition, "fingerprint">,
): string {
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings([
		certificate.kind,
		certificate.assemblyPlan.fingerprint,
		certificate.childLinks.fingerprint,
		certificate.stepLedgerFingerprint,
		certificate.organizations.fingerprint,
		certificate.organizations.edgeClaimFingerprint,
		certificate.authored.fingerprint,
		certificate.physical.fingerprint,
		certificate.readiness.fingerprint,
		certificate.persistenceEvidence.fingerprint,
		certificate.actionCapacity.fingerprint,
	]);
	checksum.addNumbers([
		certificate.version,
		certificate.valid ? 1 : 0,
		certificate.placementReady ? 1 : 0,
		certificate.simulationReady ? 1 : 0,
		certificate.persistenceReady ? 1 : 0,
		certificate.createProjectReady ? 1 : 0,
		certificate.steps.length,
		certificate.edgeClaims.length,
		certificate.authored.cells,
		certificate.authored.directedEdges,
		certificate.actionCapacity.exactOrganizations,
	]);
	return `openfab-fab-composition:v${OPENFAB_FAB_COMPOSER_VERSION}:${checksum.digest()}`;
}

/** Return one fail-closed reason for copied or tampered composition evidence. */
export function validateOpenFabFabCompositionCertificate(value: unknown): string | null {
	try {
		if (!isRecord(value)) return "OpenFab Fab composition certificate must be an object.";
		if (value.kind !== "certified-openfab-fab-composition") {
			return "OpenFab Fab composition certificate kind is invalid.";
		}
		if (value.version !== OPENFAB_FAB_COMPOSER_VERSION) {
			return `OpenFab Fab composition certificate version must be ${OPENFAB_FAB_COMPOSER_VERSION}.`;
		}
		if (
			value.valid !== true ||
			value.placementReady !== false ||
			value.simulationReady !== false ||
			value.persistenceReady !== true ||
			value.createProjectReady !== true
		) {
			return "OpenFab Fab composition readiness flags violate the version 1 contract.";
		}
		const certificate = value as unknown as CertifiedOpenFabFabComposition;
		if (!Object.isFrozen(certificate)) return "OpenFab Fab composition certificate must be frozen.";

		const assemblyPlanError = validateOpenFabFabAssemblyPlan(certificate.assemblyPlan);
		if (assemblyPlanError) return assemblyPlanError;
		if (JSON.stringify(certificate.profile) !== JSON.stringify(certificate.assemblyPlan.profile)) {
			return "OpenFab Fab composition profile does not match its canonical assembly plan.";
		}
		if (!childLinkEvidenceMatches(certificate.assemblyPlan, certificate.childLinks)) {
			return "OpenFab Fab child-link evidence does not match the assembly plan.";
		}
		if (compositionStepLedgerFingerprint(certificate.steps) !== certificate.stepLedgerFingerprint) {
			return "OpenFab Fab composition step ledger fingerprint is invalid.";
		}
		if (!compositionStepClaimsMatch(certificate.steps, certificate.edgeClaims)) {
			return "OpenFab Fab composition steps do not partition the exact edge claims.";
		}
		if (
			openFabFabOrganizationEdgeClaimFingerprint(certificate.edgeClaims) !==
			certificate.organizations.edgeClaimFingerprint
		) {
			return "OpenFab Fab edge claims do not match organization evidence.";
		}
		if (
			openFabFabOrganizationCertificationFingerprint(certificate.organizations) !==
			certificate.organizations.fingerprint
		) {
			return "OpenFab Fab organization certificate fingerprint is invalid.";
		}
		if (
			certificate.edgeClaims.length !== certificate.authored.directedEdges ||
			certificate.organizations.compilation.edgeCount !== certificate.authored.directedEdges ||
			certificate.assemblyPlan.capacity.plannedDirectedEdges !== certificate.authored.directedEdges
		) {
			return "OpenFab Fab exact directed-edge counts are inconsistent.";
		}
		if (authoredCertificateFingerprint(certificate.authored) !== certificate.authored.fingerprint) {
			return "OpenFab Fab authored certificate fingerprint is invalid.";
		}
		if (physicalCertificateFingerprint(certificate.physical) !== certificate.physical.fingerprint) {
			return "OpenFab Fab physical certificate fingerprint is invalid.";
		}
		if (
			readinessCertificateFingerprint(certificate.readiness) !== certificate.readiness.fingerprint
		) {
			return "OpenFab Fab readiness certificate fingerprint is invalid.";
		}
		const persistenceError = validatePersistenceEvidence(certificate);
		if (persistenceError) return persistenceError;
		const recertificationError = recertifyCompositionSnapshot(certificate);
		if (recertificationError) return recertificationError;
		const expectedActionCapacity = createActionCapacity(
			certificate.authored.directedEdges,
			certificate.organizations.manifest.counts.organizationRecords,
		);
		if (JSON.stringify(expectedActionCapacity) !== JSON.stringify(certificate.actionCapacity)) {
			return "OpenFab Fab action-capacity evidence is invalid.";
		}
		if (openFabFabCompositionFingerprint(certificate) !== certificate.fingerprint) {
			return "OpenFab Fab composition fingerprint does not match its evidence.";
		}
		return null;
	} catch (error) {
		return error instanceof Error
			? `OpenFab Fab composition certificate validation failed: ${error.message}`
			: "OpenFab Fab composition certificate validation failed.";
	}
}

function commitCompositionBatch(
	map: TileMap,
	ledger: CompositionLedger,
	placement: OpenFabFabCompositionPlacement,
	pendingSteps: readonly PendingCompositionStep[],
): void {
	if (pendingSteps.length === 0) throw new Error("OpenFab composition batch cannot be empty.");
	const construction = planRailRouteBatch(
		map,
		pendingSteps.map((step) => step.planningRoute),
		placement,
	);
	if (!construction.valid) {
		throw new Error(
			`OpenFab composition batch '${pendingSteps[0]?.id ?? "unknown"}' failed: ${construction.reason}`,
		);
	}

	const mutationDelta = mutationDirectedEdgeDelta(construction.mutations);
	for (const mutation of construction.mutations) {
		if (map.getEncoded(mutation.x, mutation.y) !== mutation.before) {
			throw new Error(`OpenFab prospective mutation mismatch at ${mutation.x},${mutation.y}.`);
		}
	}
	if (mutationDelta.removed.size !== 0) {
		throw new Error("OpenFab composition batches may not remove directed edges.");
	}
	if (construction.newEdges !== mutationDelta.added.size) {
		throw new Error(
			`OpenFab composition batch edge delta mismatch: planner=${construction.newEdges}, mutation=${mutationDelta.added.size}.`,
		);
	}

	const expectedByKey = new Map<string, DirectedRailEdge>();
	const prepared = pendingSteps.map((step) => {
		const planningByKey = uniqueEdgeMap(directedEdgesForRoute(step.planningRoute), step.id);
		const ownedByKey = uniqueEdgeMap(step.ownedDirectedEdges, `${step.id} ownership`);
		for (const [key] of ownedByKey) {
			if (!planningByKey.has(key)) {
				throw new Error(
					`OpenFab composition step '${step.id}' owns edge ${key} outside its route.`,
				);
			}
			if (expectedByKey.has(key)) {
				throw new Error(`OpenFab composition batch assigns edge ${key} to multiple steps.`);
			}
			expectedByKey.set(key, ownedByKey.get(key) as DirectedRailEdge);
		}
		const reusedByKey = new Map([...planningByKey].filter(([key]) => !ownedByKey.has(key)));
		for (const [key, edge] of reusedByKey) {
			if (!mapHasDirectedEdge(map, edge) || !ledger.claimOwnerByEdgeKey.has(key)) {
				throw new Error(
					`OpenFab composition step '${step.id}' references unowned support edge ${key}.`,
				);
			}
		}
		return { step, ownedByKey, reusedByKey };
	});
	assertEdgeMapEqual(expectedByKey, mutationDelta.added, "planner ownership/mutation added");

	for (const key of mutationDelta.added.keys()) {
		if (ledger.claimOwnerByEdgeKey.has(key)) {
			throw new Error(`OpenFab composition edge ${key} was already claimed.`);
		}
	}
	const beforeEdgeCount = map.edgeCount;
	const beforeCellCount = map.size;
	const beforeRevision = map.getRevision();
	const expectedCellDelta = construction.mutations.reduce(
		(total, mutation) =>
			total +
			(mutation.before === 0 && mutation.after !== 0
				? 1
				: mutation.before !== 0 && mutation.after === 0
					? -1
					: 0),
		0,
	);
	map.applyAtomicMutations(construction.mutations, []);
	const appliedDelta = appliedDirectedEdgeDelta(map, construction.mutations);
	assertEdgeMapEqual(mutationDelta.added, appliedDelta.added, "prospective/applied added");
	assertEdgeMapEqual(mutationDelta.removed, appliedDelta.removed, "prospective/applied removed");
	if (
		map.edgeCount - beforeEdgeCount !== mutationDelta.added.size ||
		map.size - beforeCellCount !== expectedCellDelta ||
		map.getRevision() - beforeRevision !== construction.mutations.length
	) {
		throw new Error("OpenFab composition atomic publication differs from its prospective delta.");
	}

	for (const { step, ownedByKey, reusedByKey } of prepared) {
		const ownedEdges = [...ownedByKey.values()].sort(compareDirectedRailEdges);
		const reusedEdges = [...reusedByKey.values()].sort(compareDirectedRailEdges);
		const claimOffset = ledger.claims.length;
		for (const edge of ownedEdges) {
			const frozenEdge = freezeDirectedEdge(edge);
			ledger.claimOwnerByEdgeKey.set(staticFabOrganizationEdgeKey(frozenEdge), step.ownerKey);
			ledger.claims.push(Object.freeze({ edge: frozenEdge, ownerKey: step.ownerKey }));
		}
		const stepWithoutFingerprint = {
			ordinal: ledger.steps.length,
			batchOrdinal: ledger.batchOrdinal,
			id: step.id,
			kind: step.kind,
			ownerKey: step.ownerKey,
			sourcePlanFingerprint: step.sourcePlanFingerprint,
			placement,
			expectedDirectedEdges: ownedEdges.length,
			addedDirectedEdges: ownedEdges.length,
			reusedDirectedEdges: reusedEdges.length,
			claimOffset,
			claimCount: ownedEdges.length,
		} as const;
		ledger.steps.push(
			Object.freeze({
				...stepWithoutFingerprint,
				edgeFingerprint: compositionStepEdgeFingerprint(
					stepWithoutFingerprint,
					ownedEdges,
					reusedEdges,
				),
			}),
		);
	}
	ledger.batchOrdinal += 1;
}

function bayBuildStepOwnerKey(
	bay: OpenFabFabAssemblyPlan["layoutBlocks"][number]["banks"][number]["bays"][number],
	owner: ProductionBayBuildStepOwner,
): string {
	if (owner === "BAY") return bay.organizationKey;
	const loopIndex = bay.plan.processLoops.findIndex((loop) => loop.id === owner);
	const organizationKey = bay.processLoopOrganizationKeys[loopIndex];
	if (loopIndex < 0 || !organizationKey) {
		throw new Error(
			`Production Bay '${bay.key}' has no organization for build-step owner '${owner}'.`,
		);
	}
	return organizationKey;
}

function createChildLinkEvidence(plan: OpenFabFabAssemblyPlan): OpenFabFabCompositionChildLinks {
	const bayParentGateways = Object.freeze(
		plan.layoutBlocks.flatMap((block) =>
			block.banks.flatMap((bank) => bank.bays.map((bay) => bay.parentGateway)),
		),
	);
	const bankParentGateways = Object.freeze(
		plan.layoutBlocks.flatMap((block) => block.banks.map((bank) => bank.parentGateway)),
	);
	const interBlockBridges = Object.freeze([...plan.interBlockBridges]);
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings([
		"openfab-fab-composition-child-links",
		...bayParentGateways.map((link) => link.fingerprint),
		...bankParentGateways.map((link) => link.fingerprint),
		...interBlockBridges.map((link) => link.fingerprint),
	]);
	checksum.addNumbers([
		OPENFAB_FAB_COMPOSER_VERSION,
		bayParentGateways.length,
		bankParentGateways.length,
		interBlockBridges.length,
	]);
	return Object.freeze({
		bayParentGateways,
		bankParentGateways,
		interBlockBridges,
		fingerprint: `openfab-fab-composition-child-links:v${OPENFAB_FAB_COMPOSER_VERSION}:${checksum.digest()}`,
	});
}

function childLinkEvidenceMatches(
	plan: OpenFabFabAssemblyPlan,
	actual: OpenFabFabCompositionChildLinks,
): boolean {
	const expected = createChildLinkEvidence(plan);
	return (
		expected.fingerprint === actual.fingerprint &&
		expected.bayParentGateways.length === actual.bayParentGateways.length &&
		expected.bankParentGateways.length === actual.bankParentGateways.length &&
		expected.interBlockBridges.length === actual.interBlockBridges.length &&
		expected.bayParentGateways.every(
			(link, index) => link.fingerprint === actual.bayParentGateways[index]?.fingerprint,
		) &&
		expected.bankParentGateways.every(
			(link, index) => link.fingerprint === actual.bankParentGateways[index]?.fingerprint,
		) &&
		expected.interBlockBridges.every(
			(link, index) => link.fingerprint === actual.interBlockBridges[index]?.fingerprint,
		)
	);
}

function createAuthoredCertificate(
	map: TileMap,
	analysis: RailNetworkAnalysis,
	authoredChecksum: string,
): OpenFabFabAuthoredCertificate {
	const topologyFingerprint = checksumRailNetworkAnalysis(analysis, authoredChecksum);
	const withoutFingerprint = Object.freeze({
		status: "closed" as const,
		revision: map.getRevision(),
		cells: analysis.cells,
		directedEdges: analysis.edges,
		components: 1 as const,
		strongComponents: 1 as const,
		stronglyConnected: true as const,
		openEnds: 0 as const,
		unsafeJunctions: 0 as const,
		junctions: analysis.junctions,
		checksum: authoredChecksum,
		topologyFingerprint,
	});
	return Object.freeze({
		...withoutFingerprint,
		fingerprint: authoredCertificateFingerprint(withoutFingerprint),
	});
}

function authoredCertificateFingerprint(
	authored: Omit<OpenFabFabAuthoredCertificate, "fingerprint">,
): string {
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings([authored.status, authored.checksum, authored.topologyFingerprint]);
	checksum.addNumbers([
		authored.revision,
		authored.cells,
		authored.directedEdges,
		authored.components,
		authored.strongComponents,
		authored.stronglyConnected ? 1 : 0,
		authored.openEnds,
		authored.unsafeJunctions,
		authored.junctions,
	]);
	return `openfab-fab-authored:v${OPENFAB_FAB_COMPOSER_VERSION}:${checksum.digest()}`;
}

function createPhysicalCertificate(
	layout: ReturnType<typeof compilePhysicalRail>,
	topology: ReturnType<typeof analyzePhysicalPathTopology>,
): OpenFabFabPhysicalCertificate {
	const withoutFingerprint = Object.freeze({
		valid: true as const,
		paths: topology.paths,
		strongComponents: 1 as const,
		stronglyConnected: true as const,
		openPaths: 0 as const,
		invalidPaths: 0 as const,
		diagnosticCount: 0 as const,
		terminalCount: 0 as const,
		clearanceIssueCount: 0 as const,
	});
	const layoutFingerprint = checksumRailPhysicalLayout(layout);
	return Object.freeze({
		...withoutFingerprint,
		layoutFingerprint,
		fingerprint: physicalCertificateFingerprint({ ...withoutFingerprint, layoutFingerprint }),
	});
}

function physicalCertificateFingerprint(
	physical: Omit<OpenFabFabPhysicalCertificate, "fingerprint">,
): string {
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings(["openfab-fab-physical", physical.layoutFingerprint]);
	checksum.addNumbers([
		OPENFAB_FAB_COMPOSER_VERSION,
		physical.valid ? 1 : 0,
		physical.paths,
		physical.strongComponents,
		physical.stronglyConnected ? 1 : 0,
		physical.openPaths,
		physical.invalidPaths,
		physical.diagnosticCount,
		physical.terminalCount,
		physical.clearanceIssueCount,
	]);
	return `openfab-fab-physical:v${OPENFAB_FAB_COMPOSER_VERSION}:${checksum.digest()}`;
}

function createReadinessCertificate(
	report: ReturnType<typeof createRailProjectReadiness>,
): OpenFabFabReadinessCertificate {
	const withoutFingerprint = Object.freeze({
		status: "ready" as const,
		ready: true as const,
		issueCodes: Object.freeze([]) as readonly [],
		authoredChecksum: report.authoredChecksum,
		topologyFingerprint: report.topologyFingerprint,
		reportFingerprint: report.fingerprint,
	});
	return Object.freeze({
		...withoutFingerprint,
		fingerprint: readinessCertificateFingerprint(withoutFingerprint),
	});
}

function readinessCertificateFingerprint(
	readiness: Omit<OpenFabFabReadinessCertificate, "fingerprint">,
): string {
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings([
		readiness.status,
		...readiness.issueCodes,
		readiness.authoredChecksum,
		readiness.topologyFingerprint,
		readiness.reportFingerprint,
	]);
	checksum.addNumbers([readiness.ready ? 1 : 0, readiness.issueCodes.length]);
	return `openfab-fab-readiness:v${OPENFAB_FAB_COMPOSER_VERSION}:${checksum.digest()}`;
}

function createPersistenceEvidence(
	map: TileMap,
	organizations: CertifiedOpenFabFabOrganizations,
): Readonly<{
	snapshot: RailMirrorSnapshot;
	evidence: OpenFabFabPersistenceEvidence;
}> {
	const sourceCapture = captureRailMirrorSnapshot(
		map,
		0,
		emptyPortEquipmentState(),
		organizations.compilation.organizations,
	);
	if (
		sourceCapture.snapshot.checksum !== organizations.authoredChecksum ||
		checksumRailMirrorSnapshot(sourceCapture.snapshot) !== sourceCapture.snapshot.checksum
	) {
		throw new Error(
			"OpenFab source snapshot checksum does not match authored organization evidence.",
		);
	}
	const internalManifestId = `openfab-fab-cert-${organizations.manifest.profilePlanFingerprint}`;
	const sourceProject = captureOpenFabProjectFromRailSnapshot(sourceCapture.snapshot, {
		manifest: createOpenFabProjectManifest(
			internalManifestId,
			OPENFAB_FAB_COMPOSER_INTERNAL_PROJECT_NAME,
			OPENFAB_FAB_COMPOSER_INTERNAL_PROJECT_CREATED_AT,
		),
	});
	const serialized = serializeOpenFabProject(sourceProject);
	const parsed = parseOpenFabProjectJson(serialized);
	if (parsed.migratedFromVersion !== null) {
		throw new Error("OpenFab certification template unexpectedly required project migration.");
	}
	const roundTripSerialized = serializeOpenFabProject(parsed.project);
	if (roundTripSerialized !== serialized) {
		throw new Error("OpenFab project codec roundtrip is not canonical.");
	}
	const roundTripSnapshot = createRailSnapshotFromOpenFabProject(parsed.project);
	if (
		roundTripSnapshot.checksum !== sourceCapture.snapshot.checksum ||
		roundTripSnapshot.sequence !== sourceCapture.snapshot.sequence ||
		roundTripSnapshot.revision !== sourceCapture.snapshot.revision
	) {
		throw new Error(
			"OpenFab project codec roundtrip changed snapshot checksum, sequence, or revision.",
		);
	}
	const sourceSnapshotIdentity = createRoundTrippedSnapshotIdentity(sourceCapture.snapshot);
	const roundTripSnapshotIdentity = createRoundTrippedSnapshotIdentity(roundTripSnapshot);
	if (sourceSnapshotIdentity.fingerprint !== roundTripSnapshotIdentity.fingerprint) {
		throw new Error("OpenFab project codec roundtrip changed snapshot cursors or exact counts.");
	}
	const expectedOrganizationSection = captureOpenFabProjectOrganizationSection(
		organizations.compilation.organizations,
	);
	const organizationSectionEqual =
		JSON.stringify(parsed.project.areas) === JSON.stringify(expectedOrganizationSection);
	if (!organizationSectionEqual) {
		throw new Error("OpenFab project codec roundtrip changed organization evidence.");
	}
	const jsonChecksum = new OrderedTypedChecksum();
	jsonChecksum.addStrings([serialized]);
	const canonicalJsonFingerprint = jsonChecksum.digest();
	const evidenceWithoutFingerprint = Object.freeze({
		ready: true as const,
		schemaVersion: OPENFAB_PROJECT_SCHEMA_VERSION,
		internalManifestContract: "DETERMINISTIC_CERTIFICATION_TEMPLATE_V1" as const,
		serializedCharacters: serialized.length,
		canonicalJsonFingerprint,
		sourceSnapshotChecksum: sourceCapture.snapshot.checksum,
		roundTripSnapshotChecksum: roundTripSnapshot.checksum,
		snapshotIdentity: roundTripSnapshotIdentity,
		organizationSectionEqual: true as const,
	});
	return Object.freeze({
		snapshot: roundTripSnapshot,
		evidence: Object.freeze({
			...evidenceWithoutFingerprint,
			fingerprint: persistenceEvidenceFingerprint(evidenceWithoutFingerprint),
		}),
	});
}

function createRoundTrippedSnapshotIdentity(
	snapshot: RailMirrorSnapshot,
): OpenFabFabRoundTrippedSnapshotIdentity {
	let directedEdges = 0;
	for (const encoded of snapshot.encoded) {
		directedEdges += bitCount(decodeRailCell(encoded).outgoing);
	}
	const withoutFingerprint = Object.freeze({
		sequence: snapshot.sequence as 0,
		revision: snapshot.revision,
		nextAdvancedSwitchId: snapshot.nextAdvancedSwitchId,
		nextPortId: snapshot.portEquipment.nextPortId,
		nextEquipmentGroupId: snapshot.portEquipment.nextEquipmentGroupId,
		nextOrganizationId: snapshot.organizations.nextOrganizationId,
		railCells: snapshot.encoded.length,
		directedEdges,
		advancedSwitches: snapshot.switchIds.length,
		ports: snapshot.portEquipment.portIds.length,
		equipmentGroups: snapshot.portEquipment.equipmentGroupIds.length,
		organizations: snapshot.organizations.organizationIds.length,
		checksum: snapshot.checksum,
	});
	if (withoutFingerprint.sequence !== 0) {
		throw new Error("OpenFab composition snapshot sequence must be zero.");
	}
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings([withoutFingerprint.checksum]);
	checksum.addNumbers([
		withoutFingerprint.sequence,
		withoutFingerprint.revision,
		withoutFingerprint.nextAdvancedSwitchId,
		withoutFingerprint.nextPortId,
		withoutFingerprint.nextEquipmentGroupId,
		withoutFingerprint.nextOrganizationId,
		withoutFingerprint.railCells,
		withoutFingerprint.directedEdges,
		withoutFingerprint.advancedSwitches,
		withoutFingerprint.ports,
		withoutFingerprint.equipmentGroups,
		withoutFingerprint.organizations,
	]);
	return Object.freeze({
		...withoutFingerprint,
		fingerprint: `openfab-fab-roundtripped-snapshot:v${OPENFAB_FAB_COMPOSER_VERSION}:${checksum.digest()}`,
	});
}

function persistenceEvidenceFingerprint(
	evidence: Omit<OpenFabFabPersistenceEvidence, "fingerprint">,
): string {
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings([
		evidence.internalManifestContract,
		evidence.canonicalJsonFingerprint,
		evidence.sourceSnapshotChecksum,
		evidence.roundTripSnapshotChecksum,
		evidence.snapshotIdentity.fingerprint,
	]);
	checksum.addNumbers([
		evidence.ready ? 1 : 0,
		evidence.schemaVersion,
		evidence.serializedCharacters,
		evidence.organizationSectionEqual ? 1 : 0,
	]);
	return `openfab-fab-persistence:v${OPENFAB_FAB_COMPOSER_VERSION}:${checksum.digest()}`;
}

function validatePersistenceEvidence(certificate: CertifiedOpenFabFabComposition): string | null {
	const snapshot = certificate.roundTrippedSnapshot;
	if (checksumRailMirrorSnapshot(snapshot) !== snapshot.checksum) {
		return "OpenFab Fab roundtripped snapshot checksum is invalid.";
	}
	const evidence = certificate.persistenceEvidence;
	const snapshotIdentity = createRoundTrippedSnapshotIdentity(snapshot);
	if (
		evidence.ready !== true ||
		evidence.schemaVersion !== OPENFAB_PROJECT_SCHEMA_VERSION ||
		evidence.internalManifestContract !== "DETERMINISTIC_CERTIFICATION_TEMPLATE_V1" ||
		!Number.isSafeInteger(evidence.serializedCharacters) ||
		evidence.serializedCharacters <= 0 ||
		evidence.canonicalJsonFingerprint.length === 0 ||
		evidence.sourceSnapshotChecksum !== certificate.authored.checksum ||
		evidence.roundTripSnapshotChecksum !== snapshot.checksum ||
		JSON.stringify(evidence.snapshotIdentity) !== JSON.stringify(snapshotIdentity) ||
		snapshotIdentity.revision !== certificate.authored.revision ||
		snapshotIdentity.railCells !== certificate.authored.cells ||
		snapshotIdentity.directedEdges !== certificate.authored.directedEdges ||
		snapshotIdentity.organizations !==
			certificate.organizations.manifest.counts.organizationRecords ||
		evidence.organizationSectionEqual !== true ||
		persistenceEvidenceFingerprint(evidence) !== evidence.fingerprint
	) {
		return "OpenFab Fab persistence evidence does not match the roundtripped project template.";
	}
	return null;
}

function recertifyCompositionSnapshot(certificate: CertifiedOpenFabFabComposition): string | null {
	const document = hydrateRailMirrorSnapshotDocument(certificate.roundTrippedSnapshot);
	if (
		document.map.getRevision() !== certificate.authored.revision ||
		document.map.size !== certificate.authored.cells ||
		document.map.edgeCount !== certificate.authored.directedEdges
	) {
		return "OpenFab Fab roundtripped snapshot does not match authored exact counts.";
	}
	const organizations = compileOpenFabFabOrganizations(
		document.map,
		certificate.assemblyPlan,
		certificate.edgeClaims,
	);
	if (!organizations.valid || organizations.fingerprint !== certificate.organizations.fingerprint) {
		return "OpenFab Fab roundtripped snapshot does not reproduce organization certification.";
	}
	const analysis = analyzeRailNetwork(document.map);
	try {
		assertClosedAuthoredTopology(analysis);
	} catch {
		return "OpenFab Fab roundtripped snapshot does not reproduce closed authored topology.";
	}
	const authored = createAuthoredCertificate(
		document.map,
		analysis,
		organizations.authoredChecksum,
	);
	if (JSON.stringify(authored) !== JSON.stringify(certificate.authored)) {
		return "OpenFab Fab roundtripped snapshot does not reproduce authored certification.";
	}
	const physicalLayout = compilePhysicalRail(document.map);
	const physicalTopology = analyzePhysicalPathTopology(physicalLayout.paths);
	if (
		!physicalLayout.valid ||
		physicalLayout.diagnostics.length !== 0 ||
		physicalLayout.terminals.length !== 0 ||
		physicalLayout.clearance.issues.count !== 0 ||
		physicalTopology.invalidPaths !== 0 ||
		physicalTopology.openPaths !== 0 ||
		physicalTopology.strongComponents !== 1 ||
		!physicalTopology.stronglyConnected
	) {
		return "OpenFab Fab roundtripped snapshot does not reproduce valid physical topology.";
	}
	const physical = createPhysicalCertificate(physicalLayout, physicalTopology);
	if (JSON.stringify(physical) !== JSON.stringify(certificate.physical)) {
		return "OpenFab Fab roundtripped snapshot does not reproduce physical certification.";
	}
	const readinessReport = createRailProjectReadiness(
		analysis,
		physicalLayout,
		organizations.authoredChecksum,
	);
	if (!readinessReport.ready || readinessReport.issues.length !== 0) {
		return "OpenFab Fab roundtripped snapshot does not reproduce project readiness.";
	}
	const readiness = createReadinessCertificate(readinessReport);
	if (JSON.stringify(readiness) !== JSON.stringify(certificate.readiness)) {
		return "OpenFab Fab roundtripped snapshot does not reproduce readiness certification.";
	}
	return null;
}

function createActionCapacity(
	directedEdges: number,
	organizations: number,
): OpenFabFabCompositionActionCapacity {
	const placementEligibility: OpenFabFabPortablePlacementEligibility =
		directedEdges > STATIC_FAB_ORGANIZATION_BUNDLE_MAX_RAIL_EDGES
			? "PLACEMENT_EDGE_LIMIT"
			: organizations > STATIC_FAB_ORGANIZATION_BUNDLE_MAX_ORGANIZATIONS
				? "PLACEMENT_ORGANIZATION_LIMIT"
				: "ELIGIBLE";
	const withoutFingerprint = Object.freeze({
		exactDirectedEdges: directedEdges,
		exactOrganizations: organizations,
		createProject: Object.freeze({ ready: true as const, eligibility: "ELIGIBLE" as const }),
		portablePlacement: Object.freeze({
			eligible: placementEligibility === "ELIGIBLE",
			eligibility: placementEligibility,
			directedEdgeLimit: STATIC_FAB_ORGANIZATION_BUNDLE_MAX_RAIL_EDGES,
			organizationLimit: STATIC_FAB_ORGANIZATION_BUNDLE_MAX_ORGANIZATIONS,
			directedEdgeHeadroom: Math.max(
				0,
				STATIC_FAB_ORGANIZATION_BUNDLE_MAX_RAIL_EDGES - directedEdges,
			),
			organizationHeadroom: Math.max(
				0,
				STATIC_FAB_ORGANIZATION_BUNDLE_MAX_ORGANIZATIONS - organizations,
			),
		}),
	});
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings([
		withoutFingerprint.createProject.eligibility,
		withoutFingerprint.portablePlacement.eligibility,
	]);
	checksum.addNumbers([
		directedEdges,
		organizations,
		withoutFingerprint.createProject.ready ? 1 : 0,
		withoutFingerprint.portablePlacement.eligible ? 1 : 0,
		withoutFingerprint.portablePlacement.directedEdgeLimit,
		withoutFingerprint.portablePlacement.organizationLimit,
		withoutFingerprint.portablePlacement.directedEdgeHeadroom,
		withoutFingerprint.portablePlacement.organizationHeadroom,
	]);
	return Object.freeze({
		...withoutFingerprint,
		fingerprint: `openfab-fab-action-capacity:v${OPENFAB_FAB_COMPOSER_VERSION}:${checksum.digest()}`,
	});
}

function compositionStepLedgerFingerprint(steps: readonly OpenFabFabCompositionStep[]): string {
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings(["openfab-fab-composition-steps"]);
	checksum.addNumbers([OPENFAB_FAB_COMPOSER_VERSION, steps.length]);
	for (const step of steps) {
		checksum.addStrings([
			step.id,
			step.kind,
			step.ownerKey,
			step.sourcePlanFingerprint,
			step.placement,
			step.edgeFingerprint,
		]);
		checksum.addNumbers([
			step.ordinal,
			step.batchOrdinal,
			step.expectedDirectedEdges,
			step.addedDirectedEdges,
			step.reusedDirectedEdges,
			step.claimOffset,
			step.claimCount,
		]);
	}
	return `openfab-fab-composition-steps:v${OPENFAB_FAB_COMPOSER_VERSION}:${checksum.digest()}`;
}

function compositionStepClaimsMatch(
	steps: readonly OpenFabFabCompositionStep[],
	claims: readonly StaticFabOrganizationDirectedEdgeClaim[],
): boolean {
	let claimOffset = 0;
	let lastBatchOrdinal = -1;
	const edgeKeys = new Set<string>();
	for (let index = 0; index < steps.length; index += 1) {
		const step = steps[index];
		if (
			!step ||
			step.ordinal !== index ||
			step.batchOrdinal < lastBatchOrdinal ||
			step.claimOffset !== claimOffset ||
			step.claimCount !== step.addedDirectedEdges ||
			step.expectedDirectedEdges !== step.addedDirectedEdges
		) {
			return false;
		}
		for (const claim of claims.slice(claimOffset, claimOffset + step.claimCount)) {
			const key = staticFabOrganizationEdgeKey(claim.edge);
			if (
				claim.ownerKey !== step.ownerKey ||
				directionBetween(claim.edge.from, claim.edge.to) === null ||
				edgeKeys.has(key)
			) {
				return false;
			}
			edgeKeys.add(key);
		}
		claimOffset += step.claimCount;
		lastBatchOrdinal = step.batchOrdinal;
	}
	return claimOffset === claims.length && edgeKeys.size === claims.length;
}

function compositionStepEdgeFingerprint(
	step: Omit<OpenFabFabCompositionStep, "edgeFingerprint">,
	ownedEdges: readonly DirectedRailEdge[],
	reusedEdges: readonly DirectedRailEdge[],
): string {
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings([
		step.id,
		step.kind,
		step.ownerKey,
		step.sourcePlanFingerprint,
		step.placement,
		...ownedEdges.map(staticFabOrganizationEdgeKey),
		"reused",
		...reusedEdges.map(staticFabOrganizationEdgeKey),
	]);
	checksum.addNumbers([
		step.ordinal,
		step.batchOrdinal,
		step.expectedDirectedEdges,
		step.addedDirectedEdges,
		step.reusedDirectedEdges,
		step.claimOffset,
		step.claimCount,
	]);
	return checksum.digest();
}

function directedEdgesForRoute(route: readonly Cell[]): readonly DirectedRailEdge[] {
	if (route.length < 2)
		throw new Error("OpenFab composition route must contain at least two cells.");
	const edges: DirectedRailEdge[] = [];
	for (let index = 0; index < route.length - 1; index += 1) {
		const from = route[index];
		const to = route[index + 1];
		if (!from || !to || directionBetween(from, to) === null) {
			throw new Error(`OpenFab composition route has a non-cardinal step at index ${index}.`);
		}
		edges.push(freezeDirectedEdge({ from, to }));
	}
	return Object.freeze(edges);
}

function mutationDirectedEdgeDelta(mutations: readonly TileMapCellMutation[]): Readonly<{
	added: ReadonlyMap<string, DirectedRailEdge>;
	removed: ReadonlyMap<string, DirectedRailEdge>;
}> {
	const added = new Map<string, DirectedRailEdge>();
	const removed = new Map<string, DirectedRailEdge>();
	for (const mutation of mutations) {
		appendOutgoingDelta(
			{ x: mutation.x, y: mutation.y },
			decodeRailCell(mutation.before).outgoing,
			decodeRailCell(mutation.after).outgoing,
			added,
			removed,
		);
	}
	return Object.freeze({ added, removed });
}

function appliedDirectedEdgeDelta(
	map: TileMap,
	mutations: readonly TileMapCellMutation[],
): Readonly<{
	added: ReadonlyMap<string, DirectedRailEdge>;
	removed: ReadonlyMap<string, DirectedRailEdge>;
}> {
	const added = new Map<string, DirectedRailEdge>();
	const removed = new Map<string, DirectedRailEdge>();
	for (const mutation of mutations) {
		if (map.getEncoded(mutation.x, mutation.y) !== mutation.after) {
			throw new Error(`OpenFab applied mutation mismatch at ${mutation.x},${mutation.y}.`);
		}
		appendOutgoingDelta(
			{ x: mutation.x, y: mutation.y },
			decodeRailCell(mutation.before).outgoing,
			map.getRail(mutation.x, mutation.y).outgoing,
			added,
			removed,
		);
	}
	return Object.freeze({ added, removed });
}

function appendOutgoingDelta(
	from: Cell,
	beforeOutgoing: number,
	afterOutgoing: number,
	added: Map<string, DirectedRailEdge>,
	removed: Map<string, DirectedRailEdge>,
): void {
	for (const direction of ALL_DIRECTIONS) {
		const before = (beforeOutgoing & direction) !== 0;
		const after = (afterOutgoing & direction) !== 0;
		if (before === after) continue;
		const edge = freezeDirectedEdge({ from, to: moveCell(from, direction) });
		const target = after ? added : removed;
		const key = staticFabOrganizationEdgeKey(edge);
		if (target.has(key)) throw new Error(`Duplicate mutation-derived edge ${key}.`);
		target.set(key, edge);
	}
}

function uniqueEdgeMap(
	edges: readonly DirectedRailEdge[],
	label: string,
): ReadonlyMap<string, DirectedRailEdge> {
	const result = new Map<string, DirectedRailEdge>();
	for (const edge of edges) {
		if (directionBetween(edge.from, edge.to) === null) {
			throw new Error(`OpenFab ${label} contains a non-cardinal directed edge.`);
		}
		const key = staticFabOrganizationEdgeKey(edge);
		if (result.has(key)) throw new Error(`OpenFab ${label} contains duplicate edge ${key}.`);
		result.set(key, freezeDirectedEdge(edge));
	}
	return result;
}

function assertEdgeMapEqual(
	expected: ReadonlyMap<string, DirectedRailEdge>,
	actual: ReadonlyMap<string, DirectedRailEdge>,
	label: string,
): void {
	if (expected.size !== actual.size) {
		throw new Error(`OpenFab ${label} edge count mismatch: ${expected.size}/${actual.size}.`);
	}
	for (const key of expected.keys()) {
		if (!actual.has(key)) throw new Error(`OpenFab ${label} is missing edge ${key}.`);
	}
}

function mapHasDirectedEdge(map: TileMap, edge: DirectedRailEdge): boolean {
	const direction = directionBetween(edge.from, edge.to);
	return direction !== null && (map.getRail(edge.from.x, edge.from.y).outgoing & direction) !== 0;
}

function assertClosedAuthoredTopology(analysis: RailNetworkAnalysis): void {
	if (
		analysis.status !== "closed" ||
		analysis.components !== 1 ||
		analysis.strongComponents !== 1 ||
		!analysis.stronglyConnected ||
		analysis.openEnds !== 0 ||
		analysis.unsafeJunctions !== 0
	) {
		throw new Error(
			`OpenFab authored topology certification failed: status=${analysis.status}, components=${analysis.components}, strongComponents=${analysis.strongComponents}, openEnds=${analysis.openEnds}, unsafeJunctions=${analysis.unsafeJunctions}.`,
		);
	}
}

function freezeDirectedEdge(edge: DirectedRailEdge): DirectedRailEdge {
	return Object.freeze({
		from: Object.freeze({ x: edge.from.x, y: edge.from.y }),
		to: Object.freeze({ x: edge.to.x, y: edge.to.y }),
	});
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
