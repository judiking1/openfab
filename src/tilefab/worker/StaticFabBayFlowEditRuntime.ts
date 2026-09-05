import { PATH_KIND } from "../compile/PhysicalPathCompiler";
import { buildPhysicalPathAdjacency } from "../compile/PhysicalPathFlow";
import { analyzePhysicalPathTopology } from "../compile/PhysicalPathTopology";
import type { CompiledPhysicalLayout } from "../compile/PhysicalRailCompiler";
import { compilePhysicalRail } from "../compile/PhysicalRailCompiler";
import { resolvePortAttachment } from "../compile/PortAttachmentResolver";
import {
	applyPortEquipmentMutations,
	type PortEquipmentState,
	portEquipmentStateError,
} from "../core/EquipmentGroup";
import { analyzeRailNetwork } from "../core/network";
import { portEquipmentLayoutError } from "../core/PortEquipmentLayoutValidator";
import {
	planStaticFabBayFlowEditWithProspectiveState,
	type StaticFabBayFlowEditIntent,
	type StaticFabBayFlowEditPlan,
	type StaticFabBayFlowEditReview,
	staticFabBayFlowEditIntentError,
} from "../core/StaticFabBayFlowEdit";
import {
	staticFabBayFlowEditIntentFingerprint,
	staticFabBayFlowEditPlanFingerprint,
} from "../core/StaticFabBayFlowEditCertification";
import {
	applyStaticFabOrganizationMutations,
	reverseStaticFabOrganizationMutations,
	type StaticFabOrganizationState,
	staticFabOrganizationStateError,
} from "../core/StaticFabOrganization";
import {
	StaticFabOrganizationImpactIndex,
	staticFabOrganizationImpactsForPatch,
	unhandledStaticFabOrganizationImpacts,
} from "../core/StaticFabOrganizationImpactIndex";
import type { TileMap } from "../core/TileMap";
import {
	checksumRailMap,
	checksumRailPatchResult,
	type RailMirrorSnapshot,
} from "./RailMirrorChecksum";
import { hydrateRailMirrorSnapshotDocument } from "./RailMirrorSnapshotDocument";
import {
	type PrepareBoundStaticFabBayFlowEditRequest,
	type PreparedStaticFabBayFlowEdit,
	type PrepareStaticFabBayFlowEditRequest,
	STATIC_FAB_BAY_FLOW_EDIT_COMPACT_REVIEW_LIMIT,
	type StaticFabBayFlowEditFailureCode,
	type StaticFabBayFlowEditSourceIdentity,
	type StaticFabBayFlowEditTopologyEvidence,
} from "./StaticFabBayFlowEditProtocol";

export type StaticFabBayFlowEditClock = () => number;

export interface StaticFabBayFlowEditRuntimeSession {
	readonly source: ReturnType<typeof hydrateRailMirrorSnapshotDocument>;
	readonly sourceIdentity: StaticFabBayFlowEditSourceIdentity;
	readonly sourceEvidence: StaticFabBayFlowEditTopologyEvidence;
}

/** Hydrate, checksum, compile, and validate one immutable source generation in a disposable Worker. */
export function hydrateStaticFabBayFlowEditSession(
	snapshot: RailMirrorSnapshot,
): StaticFabBayFlowEditRuntimeSession {
	const source = hydrateRailMirrorSnapshotDocument(snapshot);
	const sourceChecksum = checksumRailMap(
		source.map,
		source.portEquipment,
		source.organizations,
		source.relationships,
	);
	if (sourceChecksum !== snapshot.checksum) {
		throw new Error("Bay flow edit source checksum diverged after hydration.");
	}
	const equipmentStateIssue = portEquipmentStateError(source.portEquipment);
	if (equipmentStateIssue) throw new Error(equipmentStateIssue);
	const equipmentLayoutIssue = portEquipmentLayoutError(source.map, source.portEquipment);
	if (equipmentLayoutIssue) throw new Error(equipmentLayoutIssue);
	const organizationIssue = staticFabOrganizationStateError(
		source.map,
		source.portEquipment,
		source.organizations,
	);
	if (organizationIssue) throw new Error(organizationIssue);

	let sourceLayout: CompiledPhysicalLayout | null = null;
	try {
		sourceLayout = compilePhysicalRail(source.map);
		assertPhysicalPortAttachments(sourceLayout, source.portEquipment);
		return Object.freeze({
			source,
			sourceIdentity: sourceIdentityFromSnapshot(snapshot),
			sourceEvidence: createTopologyEvidence(source.map, sourceLayout),
		});
	} finally {
		// A session deliberately retains authored truth, never the large snapshot or compiled buffers.
		sourceLayout = null;
	}
}

/** Compatibility entry point for one isolated snapshot + intent proof. */
export function prepareStaticFabBayFlowEdit(
	request: PrepareStaticFabBayFlowEditRequest,
	now: StaticFabBayFlowEditClock = () => performance.now(),
): PreparedStaticFabBayFlowEdit {
	let session: StaticFabBayFlowEditRuntimeSession | null = null;
	try {
		try {
			session = hydrateStaticFabBayFlowEditSession(request.snapshot);
		} catch (error) {
			return rejected(
				null,
				null,
				null,
				"snapshot",
				message(error, "Bay flow edit snapshot could not be hydrated"),
				0,
				0,
			);
		}
		return prepareStaticFabBayFlowEditInSession(
			{
				...request,
				expectedSource: sourceIdentityFromSnapshot(request.snapshot),
			},
			session,
			now,
		);
	} finally {
		// The compatibility path is one-shot; do not retain its hydrated document after returning.
		session = null;
	}
}

/** Plan and exactly validate one small intent against an already hydrated Worker generation. */
export function prepareStaticFabBayFlowEditInSession(
	request: PrepareBoundStaticFabBayFlowEditRequest,
	session: StaticFabBayFlowEditRuntimeSession,
	now: StaticFabBayFlowEditClock = () => performance.now(),
): PreparedStaticFabBayFlowEdit {
	const { source, sourceEvidence, sourceIdentity } = session;
	if (!sourceIdentitiesEqual(request.expectedSource, sourceIdentity)) {
		return rejected(
			null,
			null,
			sourceEvidence,
			"stale",
			"Worker에 고정된 FAB 세대와 Bay 내부 흐름 변경 요청이 다릅니다",
			0,
			0,
		);
	}
	if (!Number.isSafeInteger(request.ticketId) || request.ticketId <= 0) {
		return rejected(
			null,
			null,
			sourceEvidence,
			"intent",
			"Bay flow edit ticket id is invalid.",
			0,
			0,
		);
	}
	const intentError = staticFabBayFlowEditIntentError(request.intent);
	if (intentError) return rejected(null, null, sourceEvidence, "intent", intentError, 0, 0);

	let intentFingerprint: string;
	try {
		intentFingerprint = staticFabBayFlowEditIntentFingerprint(request.intent);
	} catch (error) {
		return rejected(
			null,
			null,
			sourceEvidence,
			"fingerprint",
			message(error, "Bay flow edit intent fingerprint could not be calculated"),
			0,
			0,
		);
	}
	if (intentFingerprint !== request.expectedIntentFingerprint) {
		return rejected(
			null,
			null,
			sourceEvidence,
			"fingerprint",
			"Bay flow edit intent changed during Worker transfer.",
			0,
			0,
		);
	}
	const sourceClosureIssue = closedComponentEvidenceError(sourceEvidence);
	if (sourceClosureIssue) {
		return rejected(
			null,
			null,
			sourceEvidence,
			"source-topology",
			`Bay flow edit source is not component-closed: ${sourceClosureIssue}`,
			0,
			0,
		);
	}

	const planningStartedAt = now();
	let planning = planStaticFabBayFlowEditWithProspectiveState(
		source.map,
		source.portEquipment,
		source.getPatchSequence(),
		source.organizations,
		request.intent,
	);
	const plan = planning.plan;
	let plannerProspective = planning.prospectiveState;
	planning = { plan, prospectiveState: null };
	const planningMilliseconds = elapsed(now, planningStartedAt);
	if (!plan.valid) {
		plannerProspective = null;
		const compact = compactPlan(plan);
		return rejected(
			compact,
			compact.review,
			sourceEvidence,
			"plan",
			plan.reason,
			planningMilliseconds,
			0,
		);
	}
	if (
		plan.baseRevision !== sourceIdentity.revision ||
		plan.basePatchSequence !== sourceIdentity.patchSequence ||
		plan.nextOrganizationIdBefore !== sourceIdentity.nextOrganizationId ||
		plan.nextOrganizationIdAfter !== sourceIdentity.nextOrganizationId
	) {
		plannerProspective = null;
		const compact = compactPlan(plan);
		return rejected(
			compact,
			compact.review,
			sourceEvidence,
			"stale",
			"Bay flow edit plan does not match the hydrated source generation.",
			planningMilliseconds,
			0,
		);
	}
	if (!plannerProspective) {
		const compact = compactPlan(plan);
		return rejected(
			compact,
			compact.review,
			sourceEvidence,
			"plan",
			"Bay flow edit prospective state is missing.",
			planningMilliseconds,
			0,
		);
	}
	const sourceTopologyIssue = sourceTopologyError(
		sourceEvidence,
		plan,
		plan.review,
		request.intent,
	);
	if (sourceTopologyIssue) {
		plannerProspective = null;
		const compact = compactPlan(plan);
		return rejected(
			compact,
			compact.review,
			sourceEvidence,
			"source-topology",
			sourceTopologyIssue,
			planningMilliseconds,
			0,
		);
	}

	const validationStartedAt = now();
	let prospectiveMap: TileMap | null = null;
	let prospectiveEquipment: PortEquipmentState | null = null;
	let prospectiveOrganizations: StaticFabOrganizationState | null = null;
	let prospectiveLayout: CompiledPhysicalLayout | null = null;
	let prospectiveEvidence: StaticFabBayFlowEditTopologyEvidence | null = null;
	try {
		try {
			prospectiveMap = source.map.clone();
			if (!prospectiveMap.applyAtomicMutations(plan.mutations, plan.switchMutations)) {
				throw new Error("Bay flow edit rail before-values do not match the source.");
			}
			prospectiveEquipment = applyPortEquipmentMutations(
				source.portEquipment,
				plan.portMutations,
				plan.equipmentGroupMutations,
			);
			const equipmentStateIssue = portEquipmentStateError(prospectiveEquipment);
			if (equipmentStateIssue) throw new Error(equipmentStateIssue);
			const equipmentLayoutIssue = portEquipmentLayoutError(prospectiveMap, prospectiveEquipment);
			if (equipmentLayoutIssue) throw new Error(equipmentLayoutIssue);
			prospectiveOrganizations = applyStaticFabOrganizationMutations(
				source.organizations,
				plan.organizationMutations,
				plan.nextOrganizationIdAfter,
			);
			const organizationIssue = staticFabOrganizationStateError(
				prospectiveMap,
				prospectiveEquipment,
				prospectiveOrganizations,
			);
			if (organizationIssue) throw new Error(organizationIssue);
			assertOrganizationImpactSymmetry(
				source.portEquipment,
				source.organizations,
				prospectiveEquipment,
				prospectiveOrganizations,
				plan,
			);
		} catch (error) {
			const compact = compactPlan(plan);
			return rejected(
				compact,
				compact.review,
				sourceEvidence,
				"prospective",
				message(error, "Bay flow edit prospective authored state is invalid"),
				planningMilliseconds,
				elapsed(now, validationStartedAt),
			);
		}

		try {
			prospectiveLayout = compilePhysicalRail(prospectiveMap);
			assertPhysicalPortAttachments(prospectiveLayout, prospectiveEquipment);
			prospectiveEvidence = createTopologyEvidence(prospectiveMap, prospectiveLayout);
		} catch (error) {
			const compact = compactPlan(plan);
			return rejected(
				compact,
				compact.review,
				sourceEvidence,
				"compile",
				message(error, "Bay flow edit prospective physical state is invalid"),
				planningMilliseconds,
				elapsed(now, validationStartedAt),
			);
		}

		const topologyIssue = prospectiveTopologyError(
			sourceEvidence,
			prospectiveEvidence,
			plan.review,
		);
		if (topologyIssue) {
			const compact = compactPlan(plan);
			return rejected(
				compact,
				compact.review,
				sourceEvidence,
				"topology",
				topologyIssue,
				planningMilliseconds,
				elapsed(now, validationStartedAt),
				prospectiveEvidence,
			);
		}

		try {
			const prospectiveChecksum = checksumRailMap(
				prospectiveMap,
				prospectiveEquipment,
				prospectiveOrganizations,
				source.relationships,
			);
			const plannerProspectiveChecksum = checksumRailMap(
				plannerProspective.map,
				plannerProspective.portEquipment,
				plannerProspective.organizations,
				source.relationships,
			);
			const incrementalChecksum = checksumRailPatchResult(sourceIdentity.checksum, {
				changes: plan.mutations,
				switchChanges: plan.switchMutations,
				portChanges: plan.portMutations,
				equipmentGroupChanges: plan.equipmentGroupMutations,
				organizationChanges: plan.organizationMutations,
				organizationNextIdBefore: plan.nextOrganizationIdBefore,
				organizationNextIdAfter: plan.nextOrganizationIdAfter,
			});
			if (
				prospectiveChecksum !== plannerProspectiveChecksum ||
				prospectiveChecksum !== incrementalChecksum
			) {
				throw new Error("Bay flow edit full, planner, and incremental checksums diverged.");
			}
			if (
				prospectiveMap.getAdvancedSwitchIdCursor() !== sourceIdentity.nextAdvancedSwitchId ||
				prospectiveEquipment.nextPortId !== sourceIdentity.nextPortId ||
				prospectiveEquipment.nextEquipmentGroupId !== sourceIdentity.nextEquipmentGroupId ||
				prospectiveOrganizations.nextOrganizationId !== sourceIdentity.nextOrganizationId
			) {
				throw new Error("Bay flow edit changed a monotonic identity cursor.");
			}
			return Object.freeze({
				plan,
				review: plan.review,
				ticket: Object.freeze({
					ticketId: request.ticketId,
					validationLevel: "exact" as const,
					sourceRevision: sourceIdentity.revision,
					sourcePatchSequence: sourceIdentity.patchSequence,
					sourceChecksum: sourceIdentity.checksum,
					sourceNextAdvancedSwitchId: sourceIdentity.nextAdvancedSwitchId,
					sourceNextPortId: sourceIdentity.nextPortId,
					sourceNextEquipmentGroupId: sourceIdentity.nextEquipmentGroupId,
					sourceNextOrganizationId: sourceIdentity.nextOrganizationId,
					intentFingerprint,
					planFingerprint: staticFabBayFlowEditPlanFingerprint(plan),
					sourceAuthoredProjectionFingerprint: plan.review.sourceAuthoredProjectionFingerprint,
					targetAuthoredProjectionFingerprint: plan.review.targetAuthoredProjectionFingerprint,
					prospectiveChecksum,
					prospectiveNextAdvancedSwitchId: prospectiveMap.getAdvancedSwitchIdCursor(),
					prospectiveNextPortId: prospectiveEquipment.nextPortId,
					prospectiveNextEquipmentGroupId: prospectiveEquipment.nextEquipmentGroupId,
					prospectiveNextOrganizationId: prospectiveOrganizations.nextOrganizationId,
				}),
				sourceEvidence,
				prospectiveEvidence,
				valid: true,
				failureCode: null,
				reason: plan.reason,
				planningMilliseconds,
				validationMilliseconds: elapsed(now, validationStartedAt),
			});
		} catch (error) {
			const compact = compactPlan(plan);
			return rejected(
				compact,
				compact.review,
				sourceEvidence,
				"prospective",
				message(error, "Bay flow edit checksum validation failed"),
				planningMilliseconds,
				elapsed(now, validationStartedAt),
				prospectiveEvidence,
			);
		}
	} finally {
		// Planning and physical compilation can dominate memory; no prospective graph escapes here.
		plannerProspective = null;
		prospectiveLayout = null;
		prospectiveMap = null;
		prospectiveEquipment = null;
		prospectiveOrganizations = null;
		prospectiveEvidence = null;
	}
}

function createTopologyEvidence(
	map: StaticFabBayFlowEditRuntimeSession["source"]["map"],
	layout: CompiledPhysicalLayout,
): StaticFabBayFlowEditTopologyEvidence {
	const authored = analyzeRailNetwork(map);
	const physical = analyzePhysicalPathTopology(layout.paths);
	const physicalComponentCount = countPhysicalWeakComponents(layout);
	const authoredComponentsClosed =
		authored.cells > 0 &&
		authored.openEnds === 0 &&
		authored.unsafeJunctions === 0 &&
		authored.components === authored.strongComponents;
	const physicalComponentsClosed =
		physical.paths > 0 &&
		layout.valid &&
		physical.invalidPaths === 0 &&
		physical.openPaths === 0 &&
		layout.diagnostics.length === 0 &&
		layout.terminals.length === 0 &&
		layout.clearance.issues.count === 0 &&
		physicalComponentCount === physical.strongComponents;
	return Object.freeze({
		authoredCellCount: authored.cells,
		authoredDirectedEdgeCount: authored.edges,
		authoredStatus: authored.status,
		authoredComponentCount: authored.components,
		authoredStrongComponentCount: authored.strongComponents,
		authoredOpenTerminalCount: authored.openEnds,
		authoredUnsafeJunctionCount: authored.unsafeJunctions,
		authoredComponentsClosed,
		physicalValid: layout.valid,
		physicalPathCount: physical.paths,
		physicalComponentCount,
		physicalStrongComponentCount: physical.strongComponents,
		physicalOpenPathCount: physical.openPaths,
		physicalInvalidPathCount: physical.invalidPaths,
		physicalDiagnosticCount: layout.diagnostics.length,
		physicalTerminalCount: layout.terminals.length,
		physicalClearanceIssueCount: layout.clearance.issues.count,
		physicalComponentsClosed,
	});
}

function countPhysicalWeakComponents(layout: CompiledPhysicalLayout): number {
	const { paths } = layout;
	if (paths.pathCount === 0) return 0;
	const adjacency = buildPhysicalPathAdjacency(paths);
	const parents = new Int32Array(paths.pathCount);
	parents.fill(-1);
	let componentCount = 0;
	for (let pathIndex = 0; pathIndex < paths.pathCount; pathIndex++) {
		if ((paths.kinds[pathIndex] as number) === PATH_KIND.INVALID) continue;
		parents[pathIndex] = pathIndex;
		componentCount++;
	}
	for (let pathIndex = 0; pathIndex < paths.pathCount; pathIndex++) {
		if (parents[pathIndex] < 0) continue;
		const start = adjacency.offsets[pathIndex] as number;
		const end = adjacency.offsets[pathIndex + 1] as number;
		for (let edgeIndex = start; edgeIndex < end; edgeIndex++) {
			const target = adjacency.targets[edgeIndex] as number;
			if (parents[target] < 0 || union(parents, pathIndex, target)) continue;
			componentCount--;
		}
	}
	return componentCount;
}

function union(parents: Int32Array, left: number, right: number): boolean {
	const leftRoot = findRoot(parents, left);
	const rightRoot = findRoot(parents, right);
	if (leftRoot === rightRoot) return true;
	if (leftRoot < rightRoot) parents[rightRoot] = leftRoot;
	else parents[leftRoot] = rightRoot;
	return false;
}

function findRoot(parents: Int32Array, index: number): number {
	let root = index;
	while ((parents[root] as number) !== root) root = parents[root] as number;
	let cursor = index;
	while ((parents[cursor] as number) !== cursor) {
		const next = parents[cursor] as number;
		parents[cursor] = root;
		cursor = next;
	}
	return root;
}

function sourceTopologyError(
	evidence: StaticFabBayFlowEditTopologyEvidence,
	plan: StaticFabBayFlowEditPlan,
	review: StaticFabBayFlowEditReview,
	intent: StaticFabBayFlowEditIntent,
): string | null {
	// Recheck the evidence at the plan boundary before trusting any plan-specific assertions.
	const closureIssue = closedComponentEvidenceError(evidence);
	if (closureIssue) return `Bay flow edit source is not component-closed: ${closureIssue}`;
	if (
		plan.switchMutations.length !== 0 ||
		plan.portMutations.length !== 0 ||
		plan.equipmentGroupMutations.length !== 0
	) {
		return "Bay flow edit cannot publish switch, port, or equipment sidecar mutations.";
	}
	if (
		review.sourceInternalFlowPattern === null ||
		review.sourceInternalFlowPattern === review.targetInternalFlowPattern ||
		review.targetInternalFlowPattern !== intent.targetInternalFlowPattern
	) {
		return "Bay flow edit source and explicit target flow evidence is inconsistent.";
	}
	if (
		review.sourceDirectedEdgeCount <= 0 ||
		review.targetDirectedEdgeCount <= 0 ||
		review.removedDirectedEdgeCount <= 0 ||
		review.addedDirectedEdgeCount <= 0 ||
		review.sourceDirectedEdgeCount !== review.targetDirectedEdgeCount ||
		review.removedDirectedEdgeCount !== review.addedDirectedEdgeCount ||
		review.changedCellCount !== plan.mutations.length ||
		plan.organizationMutations.length === 0
	) {
		return "Bay flow edit projection and atomic patch counts are inconsistent.";
	}
	if (review.incidentConnectorCount === 0) {
		return review.bankOrganizationId !== null ||
			review.connectorBankToBayDirectedEdgeKeys.length !== 0 ||
			review.connectorBayToBankDirectedEdgeKeys.length !== 0
			? "Detached Bay flow edit retained external Bank gateway evidence."
			: null;
	}
	if (
		review.incidentConnectorCount === 1 &&
		review.bankOrganizationId !== null &&
		review.connectorBankToBayDirectedEdgeKeys.length > 0 &&
		review.connectorBayToBankDirectedEdgeKeys.length > 0
	) {
		return null;
	}
	return "Attached Bay flow edit omitted exact external Bank gateway evidence.";
}

function prospectiveTopologyError(
	source: StaticFabBayFlowEditTopologyEvidence,
	prospective: StaticFabBayFlowEditTopologyEvidence,
	review: StaticFabBayFlowEditReview,
): string | null {
	const closureIssue = closedComponentEvidenceError(prospective);
	if (closureIssue) {
		return `Bay flow edit prospective state is not component-closed: ${closureIssue}`;
	}
	if (
		prospective.authoredCellCount !== source.authoredCellCount ||
		prospective.authoredDirectedEdgeCount !== source.authoredDirectedEdgeCount ||
		prospective.authoredComponentCount !== source.authoredComponentCount ||
		prospective.authoredStrongComponentCount !== source.authoredStrongComponentCount ||
		prospective.physicalPathCount !== source.physicalPathCount ||
		prospective.physicalComponentCount !== source.physicalComponentCount ||
		prospective.physicalStrongComponentCount !== source.physicalStrongComponentCount
	) {
		return "Bay flow edit must preserve authored and physical cell, edge, path, weak, and strong component counts.";
	}
	if (
		review.sourceAuthoredProjectionFingerprint.length === 0 ||
		review.targetAuthoredProjectionFingerprint.length === 0 ||
		review.sourceAuthoredProjectionFingerprint === review.targetAuthoredProjectionFingerprint
	) {
		return "Bay flow edit source and target projection evidence did not change exactly once.";
	}
	return null;
}

function closedComponentEvidenceError(
	evidence: StaticFabBayFlowEditTopologyEvidence,
): string | null {
	if (
		evidence.authoredCellCount < 1 ||
		evidence.authoredComponentCount < 1 ||
		evidence.authoredStatus !==
			(evidence.authoredComponentCount === 1 ? "closed" : "disconnected") ||
		evidence.physicalPathCount < 1
	) {
		return "authored status or physical path count is inconsistent";
	}
	if (
		!evidence.authoredComponentsClosed ||
		!evidence.physicalComponentsClosed ||
		!evidence.physicalValid ||
		evidence.authoredOpenTerminalCount !== 0 ||
		evidence.authoredUnsafeJunctionCount !== 0 ||
		evidence.physicalOpenPathCount !== 0 ||
		evidence.physicalInvalidPathCount !== 0 ||
		evidence.physicalDiagnosticCount !== 0 ||
		evidence.physicalTerminalCount !== 0 ||
		evidence.physicalClearanceIssueCount !== 0
	) {
		return "open, unsafe, invalid, diagnostic, terminal, or clearance evidence remains";
	}
	if (
		evidence.authoredComponentCount !== evidence.authoredStrongComponentCount ||
		evidence.physicalComponentCount !== evidence.physicalStrongComponentCount ||
		evidence.authoredComponentCount !== evidence.physicalComponentCount ||
		evidence.authoredStrongComponentCount !== evidence.physicalStrongComponentCount
	) {
		return "authored and physical weak/strong component evidence diverged";
	}
	return null;
}

function assertOrganizationImpactSymmetry(
	sourcePortEquipment: PortEquipmentState,
	sourceOrganizations: StaticFabOrganizationState,
	prospectivePortEquipment: PortEquipmentState,
	prospectiveOrganizations: StaticFabOrganizationState,
	plan: StaticFabBayFlowEditPlan,
): void {
	const authorizations = new Set(plan.organizationImpactAuthorizations);
	assertImpactDirection(
		createImpactIndex(sourceOrganizations),
		plan,
		sourcePortEquipment,
		prospectivePortEquipment,
		authorizations,
	);
	const reversePlan = Object.freeze({
		...plan,
		mutations: Object.freeze(
			plan.mutations.map((mutation) =>
				Object.freeze({ ...mutation, before: mutation.after, after: mutation.before }),
			),
		),
		switchMutations: Object.freeze(
			plan.switchMutations.map((mutation) =>
				Object.freeze({ ...mutation, before: mutation.after, after: mutation.before }),
			),
		),
		portMutations: Object.freeze(
			plan.portMutations.map((mutation) =>
				Object.freeze({ ...mutation, before: mutation.after, after: mutation.before }),
			),
		),
		equipmentGroupMutations: Object.freeze(
			plan.equipmentGroupMutations.map((mutation) =>
				Object.freeze({ ...mutation, before: mutation.after, after: mutation.before }),
			),
		),
		organizationMutations: reverseStaticFabOrganizationMutations(plan.organizationMutations),
	});
	assertImpactDirection(
		createImpactIndex(prospectiveOrganizations),
		reversePlan,
		prospectivePortEquipment,
		sourcePortEquipment,
		authorizations,
	);
}

function createImpactIndex(state: StaticFabOrganizationState): StaticFabOrganizationImpactIndex {
	const index = new StaticFabOrganizationImpactIndex();
	index.synchronize(state);
	return index;
}

function assertImpactDirection(
	index: StaticFabOrganizationImpactIndex,
	plan: Pick<
		StaticFabBayFlowEditPlan,
		| "mutations"
		| "switchMutations"
		| "portMutations"
		| "equipmentGroupMutations"
		| "organizationMutations"
	>,
	beforePortEquipment: PortEquipmentState,
	afterPortEquipment: PortEquipmentState,
	authorizations: ReadonlySet<number>,
): void {
	const impacts = staticFabOrganizationImpactsForPatch(
		index,
		plan.mutations,
		plan.switchMutations,
		plan.portMutations,
		plan.equipmentGroupMutations,
		beforePortEquipment,
		afterPortEquipment,
	);
	const unhandled = unhandledStaticFabOrganizationImpacts(
		index,
		impacts,
		plan.organizationMutations,
		plan.mutations,
		plan.switchMutations,
		plan.portMutations,
		plan.equipmentGroupMutations,
		beforePortEquipment,
		afterPortEquipment,
		authorizations,
	);
	if (unhandled.length > 0) {
		throw new Error(
			`Bay flow edit leaves ${unhandled.length} protected organization impacts unhandled.`,
		);
	}
}

function assertPhysicalPortAttachments(
	layout: CompiledPhysicalLayout,
	portEquipment: PortEquipmentState,
): void {
	for (const port of portEquipment.ports) {
		const attachment = resolvePortAttachment(layout, port);
		if (!attachment.ok) {
			throw new Error(
				`PORT-${port.id} physical attachment is invalid (${attachment.code}): ${attachment.message}`,
			);
		}
	}
}

function compactPlan(plan: StaticFabBayFlowEditPlan): StaticFabBayFlowEditPlan {
	const review = compactReview(plan.review);
	return Object.freeze({
		...plan,
		mutations: Object.freeze([]),
		switchMutations: Object.freeze([]),
		portMutations: Object.freeze([]),
		equipmentGroupMutations: Object.freeze([]),
		organizationMutations: Object.freeze([]),
		organizationImpactAuthorizations: Object.freeze([]),
		nextOrganizationIdAfter: plan.nextOrganizationIdBefore,
		valid: false,
		review,
	});
}

function compactReview(review: StaticFabBayFlowEditReview): StaticFabBayFlowEditReview {
	return Object.freeze({
		...review,
		changedOrganizationIds: sample(review.changedOrganizationIds),
		connectorBankToBayDirectedEdgeKeys: sample(review.connectorBankToBayDirectedEdgeKeys),
		connectorBayToBankDirectedEdgeKeys: sample(review.connectorBayToBankDirectedEdgeKeys),
	});
}

function sample<T>(values: readonly T[]): readonly T[] {
	if (values.length <= STATIC_FAB_BAY_FLOW_EDIT_COMPACT_REVIEW_LIMIT) {
		return Object.freeze([...values]);
	}
	const last = values.length - 1;
	return Object.freeze(
		Array.from(
			{ length: STATIC_FAB_BAY_FLOW_EDIT_COMPACT_REVIEW_LIMIT },
			(_, index) =>
				values[
					Math.floor((index * last) / (STATIC_FAB_BAY_FLOW_EDIT_COMPACT_REVIEW_LIMIT - 1))
				] as T,
		),
	);
}

function rejected(
	plan: StaticFabBayFlowEditPlan | null,
	review: StaticFabBayFlowEditReview | null,
	sourceEvidence: StaticFabBayFlowEditTopologyEvidence | null,
	failureCode: StaticFabBayFlowEditFailureCode,
	reason: string,
	planningMilliseconds: number,
	validationMilliseconds: number,
	prospectiveEvidence: StaticFabBayFlowEditTopologyEvidence | null = null,
): PreparedStaticFabBayFlowEdit {
	return Object.freeze({
		plan,
		review,
		ticket: null,
		sourceEvidence,
		prospectiveEvidence,
		valid: false,
		failureCode,
		reason,
		planningMilliseconds,
		validationMilliseconds,
	});
}

function sourceIdentityFromSnapshot(
	snapshot: RailMirrorSnapshot,
): StaticFabBayFlowEditSourceIdentity {
	return Object.freeze({
		revision: snapshot.revision,
		patchSequence: snapshot.sequence,
		checksum: snapshot.checksum,
		nextAdvancedSwitchId: snapshot.nextAdvancedSwitchId,
		nextPortId: snapshot.portEquipment.nextPortId,
		nextEquipmentGroupId: snapshot.portEquipment.nextEquipmentGroupId,
		nextOrganizationId: snapshot.organizations.nextOrganizationId,
	});
}

function sourceIdentitiesEqual(left: unknown, right: StaticFabBayFlowEditSourceIdentity): boolean {
	if (!isRecord(left)) return false;
	return (
		left.revision === right.revision &&
		left.patchSequence === right.patchSequence &&
		left.checksum === right.checksum &&
		left.nextAdvancedSwitchId === right.nextAdvancedSwitchId &&
		left.nextPortId === right.nextPortId &&
		left.nextEquipmentGroupId === right.nextEquipmentGroupId &&
		left.nextOrganizationId === right.nextOrganizationId
	);
}

function elapsed(now: StaticFabBayFlowEditClock, startedAt: number): number {
	return Math.max(0, now() - startedAt);
}

function message(error: unknown, fallback: string): string {
	return error instanceof Error && error.message ? error.message : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
