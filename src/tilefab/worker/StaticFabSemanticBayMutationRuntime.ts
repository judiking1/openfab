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
import {
	planStaticFabSemanticBayMutationWithProspectiveState,
	type StaticFabSemanticBayMutationIntent,
	type StaticFabSemanticBayMutationPlan,
	type StaticFabSemanticBayMutationReview,
	staticFabSemanticBayMutationIntentError,
} from "../core/StaticFabSemanticBayMutation";
import {
	staticFabSemanticBayMutationIntentFingerprint,
	staticFabSemanticBayMutationPlanFingerprint,
} from "../core/StaticFabSemanticBayMutationCertification";
import type { TileMap } from "../core/TileMap";
import {
	checksumRailMap,
	checksumRailPatchResult,
	type RailMirrorSnapshot,
} from "./RailMirrorChecksum";
import { hydrateRailMirrorSnapshotDocument } from "./RailMirrorSnapshotDocument";
import {
	type PrepareBoundStaticFabSemanticBayMutationRequest,
	type PreparedStaticFabSemanticBayMutation,
	type PrepareStaticFabSemanticBayMutationRequest,
	STATIC_FAB_SEMANTIC_BAY_MUTATION_COMPACT_REVIEW_LIMIT,
	type StaticFabSemanticBayMutationFailureCode,
	type StaticFabSemanticBayMutationSourceIdentity,
	type StaticFabSemanticBayMutationTopologyEvidence,
} from "./StaticFabSemanticBayMutationProtocol";

export type StaticFabSemanticBayMutationClock = () => number;

export interface StaticFabSemanticBayMutationRuntimeSession {
	readonly source: ReturnType<typeof hydrateRailMirrorSnapshotDocument>;
	readonly sourceIdentity: StaticFabSemanticBayMutationSourceIdentity;
	readonly sourceEvidence: StaticFabSemanticBayMutationTopologyEvidence;
}

/** Hydrate, checksum, compile, and validate one immutable source generation in a disposable Worker. */
export function hydrateStaticFabSemanticBayMutationSession(
	snapshot: RailMirrorSnapshot,
): StaticFabSemanticBayMutationRuntimeSession {
	const source = hydrateRailMirrorSnapshotDocument(snapshot);
	const sourceChecksum = checksumRailMap(source.map, source.portEquipment, source.organizations);
	if (sourceChecksum !== snapshot.checksum) {
		throw new Error("Semantic Bay mutation source checksum diverged after hydration.");
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
	const sourceLayout = compilePhysicalRail(source.map);
	assertPhysicalPortAttachments(sourceLayout, source.portEquipment);
	const sourceIdentity = sourceIdentityFromSnapshot(snapshot);
	return Object.freeze({
		source,
		sourceIdentity,
		sourceEvidence: createTopologyEvidence(source.map, sourceLayout),
	});
}

/** Compatibility entry point for one isolated snapshot + intent proof. */
export function prepareStaticFabSemanticBayMutation(
	request: PrepareStaticFabSemanticBayMutationRequest,
	now: StaticFabSemanticBayMutationClock = () => performance.now(),
): PreparedStaticFabSemanticBayMutation {
	let session: StaticFabSemanticBayMutationRuntimeSession;
	try {
		session = hydrateStaticFabSemanticBayMutationSession(request.snapshot);
	} catch (error) {
		return rejected(
			null,
			null,
			null,
			"snapshot",
			message(error, "Semantic Bay mutation snapshot could not be hydrated"),
			0,
			0,
		);
	}
	return prepareStaticFabSemanticBayMutationInSession(
		{
			...request,
			expectedSource: sourceIdentityFromSnapshot(request.snapshot),
		},
		session,
		now,
	);
}

/** Plan and exactly validate one small intent against an already hydrated Worker generation. */
export function prepareStaticFabSemanticBayMutationInSession(
	request: PrepareBoundStaticFabSemanticBayMutationRequest,
	session: StaticFabSemanticBayMutationRuntimeSession,
	now: StaticFabSemanticBayMutationClock = () => performance.now(),
): PreparedStaticFabSemanticBayMutation {
	const { source, sourceEvidence, sourceIdentity } = session;
	if (!sourceIdentitiesEqual(request.expectedSource, sourceIdentity)) {
		return rejected(
			null,
			null,
			sourceEvidence,
			"stale",
			"Worker에 고정된 FAB 세대와 semantic Bay 요청이 다릅니다",
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
			"Semantic Bay mutation ticket id is invalid.",
			0,
			0,
		);
	}
	const intentError = staticFabSemanticBayMutationIntentError(request.intent);
	if (intentError) {
		return rejected(null, null, sourceEvidence, "intent", intentError, 0, 0);
	}
	let intentFingerprint: string;
	try {
		intentFingerprint = staticFabSemanticBayMutationIntentFingerprint(request.intent);
	} catch (error) {
		return rejected(
			null,
			null,
			sourceEvidence,
			"fingerprint",
			message(error, "Semantic Bay mutation intent fingerprint could not be calculated"),
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
			"Semantic Bay mutation intent changed during Worker transfer.",
			0,
			0,
		);
	}

	const planningStartedAt = now();
	const planning = planStaticFabSemanticBayMutationWithProspectiveState(
		source.map,
		source.portEquipment,
		source.getPatchSequence(),
		source.organizations,
		request.intent,
	);
	const plan = planning.plan;
	const planningMilliseconds = elapsed(now, planningStartedAt);
	if (!plan.valid) {
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
		const compact = compactPlan(plan);
		return rejected(
			compact,
			compact.review,
			sourceEvidence,
			"stale",
			"Semantic Bay mutation plan does not match the hydrated source generation.",
			planningMilliseconds,
			0,
		);
	}
	if (!planning.prospectiveState) {
		const compact = compactPlan(plan);
		return rejected(
			compact,
			compact.review,
			sourceEvidence,
			"plan",
			"Semantic Bay mutation prospective state is missing.",
			planningMilliseconds,
			0,
		);
	}
	const sourceTopologyIssue = sourceTopologyError(sourceEvidence, plan.review, request.intent);
	if (sourceTopologyIssue) {
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
	let prospectiveMap: TileMap;
	let prospectiveEquipment: PortEquipmentState;
	let prospectiveOrganizations: typeof source.organizations;
	try {
		prospectiveMap = source.map.clone();
		if (!prospectiveMap.applyAtomicMutations(plan.mutations, plan.switchMutations)) {
			throw new Error("Semantic Bay mutation rail before-values do not match the source.");
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
			message(error, "Semantic Bay mutation prospective authored state is invalid"),
			planningMilliseconds,
			elapsed(now, validationStartedAt),
		);
	}

	let prospectiveLayout: CompiledPhysicalLayout;
	let prospectiveEvidence: StaticFabSemanticBayMutationTopologyEvidence;
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
			message(error, "Semantic Bay mutation prospective physical state is invalid"),
			planningMilliseconds,
			elapsed(now, validationStartedAt),
		);
	}
	const topologyIssue = prospectiveTopologyError(
		sourceEvidence,
		prospectiveEvidence,
		plan.review,
		request.intent,
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
		);
		const plannerProspectiveChecksum = checksumRailMap(
			planning.prospectiveState.map,
			planning.prospectiveState.portEquipment,
			planning.prospectiveState.organizations,
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
			throw new Error("Semantic Bay mutation full, planner, and incremental checksums diverged.");
		}
		if (
			prospectiveMap.getAdvancedSwitchIdCursor() !== sourceIdentity.nextAdvancedSwitchId ||
			prospectiveEquipment.nextPortId !== sourceIdentity.nextPortId ||
			prospectiveEquipment.nextEquipmentGroupId !== sourceIdentity.nextEquipmentGroupId ||
			prospectiveOrganizations.nextOrganizationId !== sourceIdentity.nextOrganizationId
		) {
			throw new Error("Semantic Bay mutation changed a monotonic identity cursor.");
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
				planFingerprint: staticFabSemanticBayMutationPlanFingerprint(plan),
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
			message(error, "Semantic Bay mutation checksum validation failed"),
			planningMilliseconds,
			elapsed(now, validationStartedAt),
			prospectiveEvidence,
		);
	}
}

function createTopologyEvidence(
	map: StaticFabSemanticBayMutationRuntimeSession["source"]["map"],
	layout: CompiledPhysicalLayout,
): StaticFabSemanticBayMutationTopologyEvidence {
	const authored = analyzeRailNetwork(map);
	const physical = analyzePhysicalPathTopology(layout.paths);
	const physicalComponentCount = countPhysicalWeakComponents(layout);
	const authoredComponentsClosed =
		authored.cells === 0
			? authored.components === 0 && authored.strongComponents === 0
			: authored.openEnds === 0 &&
				authored.unsafeJunctions === 0 &&
				authored.components === authored.strongComponents;
	const physicalComponentsClosed =
		physical.paths === 0
			? physicalComponentCount === 0 && physical.strongComponents === 0
			: layout.valid &&
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
	evidence: StaticFabSemanticBayMutationTopologyEvidence,
	review: StaticFabSemanticBayMutationReview,
	intent: StaticFabSemanticBayMutationIntent,
): string | null {
	const closureIssue = closedComponentEvidenceError(evidence, false);
	if (closureIssue) return `Semantic Bay mutation source is not component-closed: ${closureIssue}`;
	if (intent.action === "DISCONNECT") {
		if (review.incidentConnectorCount !== 1 || review.bankOrganizationId === null) {
			return "Disconnect requires one exact incident Bank connector.";
		}
		return null;
	}
	if (review.incidentConnectorCount === 1) {
		return review.bankOrganizationId === null
			? "Attached Delete omitted its Bank organization identity."
			: null;
	}
	if (review.incidentConnectorCount === 0) {
		return review.bankOrganizationId !== null
			? "Detached Delete retained an incident Bank identity."
			: null;
	}
	return "Delete incident connector evidence is invalid.";
}

function prospectiveTopologyError(
	source: StaticFabSemanticBayMutationTopologyEvidence,
	prospective: StaticFabSemanticBayMutationTopologyEvidence,
	review: StaticFabSemanticBayMutationReview,
	intent: StaticFabSemanticBayMutationIntent,
): string | null {
	const allowEmpty = intent.action === "DELETE" && review.incidentConnectorCount === 0;
	const closureIssue = closedComponentEvidenceError(prospective, allowEmpty);
	if (closureIssue) {
		return `Semantic Bay mutation prospective state is not component-closed: ${closureIssue}`;
	}
	const delta = intent.action === "DISCONNECT" ? 1 : review.incidentConnectorCount === 0 ? -1 : 0;
	const expected = source.authoredComponentCount + delta;
	if (expected < 0 || prospective.authoredComponentCount !== expected) {
		return `Semantic Bay mutation component count must change by ${delta}.`;
	}
	if (prospective.physicalComponentCount !== source.physicalComponentCount + delta) {
		return `Semantic Bay mutation physical component count must change by ${delta}.`;
	}
	return null;
}

function closedComponentEvidenceError(
	evidence: StaticFabSemanticBayMutationTopologyEvidence,
	allowEmpty: boolean,
): string | null {
	const empty = evidence.authoredCellCount === 0;
	if (empty && !allowEmpty) return "empty authored rail is not allowed";
	if (
		empty &&
		(evidence.authoredStatus !== "empty" ||
			evidence.authoredComponentCount !== 0 ||
			evidence.authoredStrongComponentCount !== 0 ||
			evidence.physicalPathCount !== 0 ||
			evidence.physicalComponentCount !== 0 ||
			evidence.physicalStrongComponentCount !== 0)
	) {
		return "empty evidence retained graph components";
	}
	if (
		!empty &&
		(evidence.authoredComponentCount < 1 ||
			evidence.authoredStatus !==
				(evidence.authoredComponentCount === 1 ? "closed" : "disconnected") ||
			evidence.physicalPathCount < 1)
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
	plan: StaticFabSemanticBayMutationPlan,
): void {
	const deletedIds = new Set(
		plan.organizationMutations
			.filter((mutation) => mutation.before !== null && mutation.after === null)
			.map((mutation) => mutation.id),
	);
	if (plan.organizationImpactAuthorizations.some((id) => deletedIds.has(id))) {
		throw new Error("Deleted organizations cannot be impact relocation authorizations.");
	}
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
		StaticFabSemanticBayMutationPlan,
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
			`Semantic Bay mutation leaves ${unhandled.length} protected organization impacts unhandled.`,
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

function compactPlan(plan: StaticFabSemanticBayMutationPlan): StaticFabSemanticBayMutationPlan {
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

function compactReview(
	review: StaticFabSemanticBayMutationReview,
): StaticFabSemanticBayMutationReview {
	return Object.freeze({
		...review,
		removedOrganizationIds: sample(review.removedOrganizationIds),
		processLoopOrganizationIds: sample(review.processLoopOrganizationIds),
		railModuleKeys: sample(review.railModuleKeys),
		connectorOutboundDirectedEdgeKeys: sample(review.connectorOutboundDirectedEdgeKeys),
		connectorReturnDirectedEdgeKeys: sample(review.connectorReturnDirectedEdgeKeys),
		equipmentGroupIds: sample(review.equipmentGroupIds),
		portIds: sample(review.portIds),
	});
}

function sample<T>(values: readonly T[]): readonly T[] {
	if (values.length <= STATIC_FAB_SEMANTIC_BAY_MUTATION_COMPACT_REVIEW_LIMIT) {
		return Object.freeze([...values]);
	}
	const last = values.length - 1;
	return Object.freeze(
		Array.from(
			{ length: STATIC_FAB_SEMANTIC_BAY_MUTATION_COMPACT_REVIEW_LIMIT },
			(_, index) =>
				values[
					Math.floor((index * last) / (STATIC_FAB_SEMANTIC_BAY_MUTATION_COMPACT_REVIEW_LIMIT - 1))
				] as T,
		),
	);
}

function rejected(
	plan: StaticFabSemanticBayMutationPlan | null,
	review: StaticFabSemanticBayMutationReview | null,
	sourceEvidence: StaticFabSemanticBayMutationTopologyEvidence | null,
	failureCode: StaticFabSemanticBayMutationFailureCode,
	reason: string,
	planningMilliseconds: number,
	validationMilliseconds: number,
	prospectiveEvidence: StaticFabSemanticBayMutationTopologyEvidence | null = null,
): PreparedStaticFabSemanticBayMutation {
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
): StaticFabSemanticBayMutationSourceIdentity {
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

function sourceIdentitiesEqual(
	left: unknown,
	right: StaticFabSemanticBayMutationSourceIdentity,
): boolean {
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

function elapsed(now: StaticFabSemanticBayMutationClock, startedAt: number): number {
	return Math.max(0, now() - startedAt);
}

function message(error: unknown, fallback: string): string {
	return error instanceof Error && error.message ? error.message : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
