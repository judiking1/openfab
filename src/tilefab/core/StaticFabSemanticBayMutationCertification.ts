import {
	type AdvancedSwitchMutation,
	type AdvancedSwitchRecord,
	copyAdvancedSwitch,
} from "./AdvancedSwitch";
import {
	copyEquipmentGroupRecord,
	type EquipmentGroupMutation,
	type EquipmentGroupRecord,
	type PortEquipmentState,
} from "./EquipmentGroup";
import { OrderedTypedChecksum } from "./OrderedTypedChecksum";
import { copyPortRecord, type PortMutation, type PortRecord } from "./PortRecord";
import {
	checksumStaticFabAssemblyRelationshipRecord,
	copyStaticFabAssemblyRelationshipRecord,
	type StaticFabAssemblyRelationshipStateV1,
	staticFabAssemblyRelationshipRecordEquals,
} from "./StaticFabAssemblyRelationship";
import {
	copyStaticFabOrganizationRecord,
	type StaticFabOrganizationMutation,
	type StaticFabOrganizationRecord,
	type StaticFabOrganizationState,
	staticFabOrganizationDeclaredSemanticRole,
	staticFabOrganizationEdgeKey,
	staticFabOrganizationParentIds,
	staticFabOrganizationProperties,
} from "./StaticFabOrganization";
import {
	expectedStaticFabDeclaredBayDisconnectRailMutations,
	STATIC_FAB_SEMANTIC_BAY_DELETE_KIND,
	STATIC_FAB_SEMANTIC_BAY_DISCONNECT_KIND,
	type StaticFabSemanticBayMutationIntent,
	type StaticFabSemanticBayMutationPlan,
	type StaticFabSemanticBayMutationReview,
	staticFabSemanticBayMutationIntentError,
} from "./StaticFabSemanticBayMutation";
import type { TileMap } from "./TileMap";

export interface StaticFabSemanticBayMutationWorkerTicket {
	readonly ticketId: number;
	readonly validationLevel: "exact";
	readonly sourceRevision: number;
	readonly sourcePatchSequence: number;
	readonly sourceChecksum: string;
	readonly sourceNextAdvancedSwitchId: number;
	readonly sourceNextPortId: number;
	readonly sourceNextEquipmentGroupId: number;
	readonly sourceNextOrganizationId: number;
	readonly sourceNextRelationshipId: number;
	readonly intentFingerprint: string;
	readonly planFingerprint: string;
	readonly prospectiveChecksum: string;
	readonly prospectiveNextAdvancedSwitchId: number;
	readonly prospectiveNextPortId: number;
	readonly prospectiveNextEquipmentGroupId: number;
	readonly prospectiveNextOrganizationId: number;
	readonly prospectiveNextRelationshipId: number;
}

/** Opaque main-realm authority for one source-bound disposable Worker request. */
export interface StaticFabSemanticBayMutationPermit {
	readonly ticketId: number;
}

interface SemanticBayMutationSource {
	readonly map: TileMap;
	readonly portEquipment: PortEquipmentState;
	readonly organizations: StaticFabOrganizationState;
	readonly relationships: StaticFabAssemblyRelationshipStateV1;
	readonly sourceChecksum: string;
	readonly sourceMapMutationGeneration: number;
}

interface SemanticBayMutationPermitSource extends SemanticBayMutationSource {
	readonly baseRevision: number;
	readonly basePatchSequence: number;
	readonly sourceNextAdvancedSwitchId: number;
	readonly sourceNextPortId: number;
	readonly sourceNextEquipmentGroupId: number;
	readonly sourceNextOrganizationId: number;
	readonly sourceNextRelationshipId: number;
	readonly intentFingerprint: string;
}

const issuedPlans = new WeakMap<object, SemanticBayMutationSource>();
const certifiedPlans = new WeakMap<
	object,
	SemanticBayMutationSource & { readonly planFingerprint: string }
>();
const pendingPermits = new WeakMap<object, SemanticBayMutationPermitSource>();
let nextTicketId = 1;

export function staticFabSemanticBayMutationIntentFingerprint(
	intent: StaticFabSemanticBayMutationIntent,
): string {
	const error = staticFabSemanticBayMutationIntentError(intent);
	if (error) throw new TypeError(error);
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings(["STATIC_FAB_SEMANTIC_BAY_MUTATION_INTENT", intent.action]);
	checksum.addNumbers([intent.version, intent.bayOrganizationId]);
	return checksum.digest();
}

export function issueStaticFabSemanticBayMutationPermit(
	map: TileMap,
	portEquipment: PortEquipmentState,
	patchSequence: number,
	organizations: StaticFabOrganizationState,
	intent: StaticFabSemanticBayMutationIntent,
	sourceChecksum: string,
	relationships: StaticFabAssemblyRelationshipStateV1,
): StaticFabSemanticBayMutationPermit {
	if (!Number.isSafeInteger(patchSequence) || patchSequence < 0) {
		throw new RangeError("Semantic Bay mutation patch sequence is invalid.");
	}
	if (typeof sourceChecksum !== "string" || sourceChecksum.length === 0) {
		throw new TypeError("Semantic Bay mutation source checksum is missing.");
	}
	if (!Number.isSafeInteger(nextTicketId)) {
		throw new RangeError("Semantic Bay mutation ticket sequence is exhausted.");
	}
	const permit = Object.freeze({ ticketId: nextTicketId++ });
	pendingPermits.set(
		permit,
		Object.freeze({
			map,
			portEquipment,
			organizations,
			relationships,
			sourceChecksum,
			sourceMapMutationGeneration: map.getMutationGeneration(),
			baseRevision: map.getRevision(),
			basePatchSequence: patchSequence,
			sourceNextAdvancedSwitchId: map.getAdvancedSwitchIdCursor(),
			sourceNextPortId: portEquipment.nextPortId,
			sourceNextEquipmentGroupId: portEquipment.nextEquipmentGroupId,
			sourceNextOrganizationId: organizations.nextOrganizationId,
			sourceNextRelationshipId: relationships.nextRelationshipId,
			intentFingerprint: staticFabSemanticBayMutationIntentFingerprint(intent),
		}),
	);
	return permit;
}

export function revokeStaticFabSemanticBayMutationPermit(
	permit: StaticFabSemanticBayMutationPermit,
): void {
	pendingPermits.delete(permit);
}

/** Consume one permit and clone the exact Worker plan into main-realm immutable ownership. */
export function adoptStaticFabSemanticBayMutationWorkerPlan(
	permit: StaticFabSemanticBayMutationPermit,
	ticket: StaticFabSemanticBayMutationWorkerTicket,
	workerPlan: StaticFabSemanticBayMutationPlan,
	expectedProspectiveChecksum: string,
	map: TileMap,
	portEquipment: PortEquipmentState,
	patchSequence: number,
	organizations: StaticFabOrganizationState,
	intent: StaticFabSemanticBayMutationIntent,
	relationships: StaticFabAssemblyRelationshipStateV1,
): StaticFabSemanticBayMutationPlan {
	const source = pendingPermits.get(permit);
	pendingPermits.delete(permit);
	if (!source) throw new Error("Semantic Bay mutation permit is missing or already consumed.");
	const intentFingerprint = staticFabSemanticBayMutationIntentFingerprint(intent);
	if (
		source.map !== map ||
		source.portEquipment !== portEquipment ||
		source.organizations !== organizations ||
		source.relationships !== relationships ||
		source.baseRevision !== map.getRevision() ||
		source.sourceMapMutationGeneration !== map.getMutationGeneration() ||
		source.basePatchSequence !== patchSequence ||
		source.sourceNextAdvancedSwitchId !== map.getAdvancedSwitchIdCursor() ||
		source.sourceNextPortId !== portEquipment.nextPortId ||
		source.sourceNextEquipmentGroupId !== portEquipment.nextEquipmentGroupId ||
		source.sourceNextOrganizationId !== organizations.nextOrganizationId ||
		source.sourceNextRelationshipId !== relationships.nextRelationshipId ||
		source.intentFingerprint !== intentFingerprint
	) {
		throw new Error("Semantic Bay mutation permit no longer matches the live document.");
	}
	if (
		ticket.ticketId !== permit.ticketId ||
		ticket.validationLevel !== "exact" ||
		ticket.sourceRevision !== source.baseRevision ||
		ticket.sourcePatchSequence !== source.basePatchSequence ||
		ticket.sourceChecksum !== source.sourceChecksum ||
		ticket.sourceNextAdvancedSwitchId !== source.sourceNextAdvancedSwitchId ||
		ticket.sourceNextPortId !== source.sourceNextPortId ||
		ticket.sourceNextEquipmentGroupId !== source.sourceNextEquipmentGroupId ||
		ticket.sourceNextOrganizationId !== source.sourceNextOrganizationId ||
		ticket.sourceNextRelationshipId !== source.sourceNextRelationshipId ||
		ticket.intentFingerprint !== intentFingerprint ||
		ticket.prospectiveNextAdvancedSwitchId !== source.sourceNextAdvancedSwitchId ||
		ticket.prospectiveNextPortId !== source.sourceNextPortId ||
		ticket.prospectiveNextEquipmentGroupId !== source.sourceNextEquipmentGroupId ||
		ticket.prospectiveNextOrganizationId !== source.sourceNextOrganizationId ||
		ticket.prospectiveNextRelationshipId !== source.sourceNextRelationshipId ||
		typeof expectedProspectiveChecksum !== "string" ||
		expectedProspectiveChecksum.length === 0 ||
		ticket.prospectiveChecksum !== expectedProspectiveChecksum
	) {
		throw new Error("Semantic Bay mutation Worker ticket does not match its one-shot permit.");
	}
	const expectedKind =
		intent.action === "DISCONNECT"
			? STATIC_FAB_SEMANTIC_BAY_DISCONNECT_KIND
			: STATIC_FAB_SEMANTIC_BAY_DELETE_KIND;
	if (
		!workerPlan.valid ||
		workerPlan.kind !== expectedKind ||
		workerPlan.baseRevision !== source.baseRevision ||
		workerPlan.basePatchSequence !== source.basePatchSequence ||
		workerPlan.nextOrganizationIdBefore !== source.sourceNextOrganizationId ||
		workerPlan.nextOrganizationIdAfter !== source.sourceNextOrganizationId ||
		workerPlan.nextRelationshipIdBefore !== source.sourceNextRelationshipId ||
		workerPlan.nextRelationshipIdAfter !== source.sourceNextRelationshipId ||
		workerPlan.issueCode !== null ||
		workerPlan.review.action !== intent.action ||
		workerPlan.review.bayOrganizationId !== intent.bayOrganizationId ||
		workerPlan.review.issueCode !== null ||
		workerPlan.review.circulationCertification !== "PENDING_WORKER_CERTIFICATION" ||
		hasDeletedOrganizationAuthorization(workerPlan)
	) {
		throw new Error("Semantic Bay mutation Worker plan is stale or invalid.");
	}
	let connectedRelationship: StaticFabAssemblyRelationshipStateV1["records"][number] | null = null;
	for (const record of relationships.records) {
		if (
			!record.participantOrganizationIds.includes(intent.bayOrganizationId) &&
			!record.managedChildOrganizationIds.includes(intent.bayOrganizationId)
		)
			continue;
		if (connectedRelationship) {
			throw new Error("Semantic Bay mutation targets multiple declared relationships.");
		}
		connectedRelationship = record;
	}
	if (workerPlan.relationshipMutations.length !== (connectedRelationship ? 1 : 0)) {
		throw new Error("Semantic Bay mutation omitted or invented a declared relationship removal.");
	}
	for (const mutation of workerPlan.relationshipMutations) {
		const before = mutation.before;
		const current = connectedRelationship;
		if (
			intent.action !== "DISCONNECT" ||
			!before ||
			!current ||
			mutation.after !== null ||
			before.id !== mutation.id ||
			before.hierarchyRole !== "BAY_TO_BANK" ||
			before.purpose !== "HIERARCHY_LINK" ||
			before.reviewPolicy !== "REVIEW_REQUIRED" ||
			before.parentOrganizationId !== workerPlan.review.bankOrganizationId ||
			!before.participantOrganizationIds.includes(intent.bayOrganizationId) ||
			before.managedChildOrganizationIds.length !== 1 ||
			before.managedChildOrganizationIds[0] !== intent.bayOrganizationId ||
			!staticFabAssemblyRelationshipRecordEquals(before, current)
		)
			throw new Error(
				"Semantic Bay mutation relationship does not match its exact source identity.",
			);
		const expected = expectedStaticFabDeclaredBayDisconnectRailMutations(map, current);
		if (
			workerPlan.mutations.length !== expected.length ||
			workerPlan.mutations.some((change, index) => {
				const cut = expected[index];
				return (
					!cut ||
					change.x !== cut.x ||
					change.y !== cut.y ||
					change.before !== cut.before ||
					change.after !== cut.after
				);
			}) ||
			workerPlan.switchMutations.length !== 0 ||
			workerPlan.portMutations.length !== 0 ||
			workerPlan.equipmentGroupMutations.length !== 0
		) {
			throw new Error("Semantic Bay mutation rail cut differs from its declared relationship.");
		}
		const outboundRole =
			current.participantOrganizationIds[0] === intent.bayOrganizationId ? "OUTBOUND" : "RETURN";
		const outbound = current.connectionGroups[0]?.legs.find(
			(leg) => leg.directionRole === outboundRole,
		);
		const inbound = current.connectionGroups[0]?.legs.find(
			(leg) => leg.directionRole !== outboundRole,
		);
		if (
			!outbound ||
			!inbound ||
			workerPlan.review.connectorDirectedEdgeCount !==
				outbound.exclusiveCutEdges.length + inbound.exclusiveCutEdges.length ||
			!sameStringList(
				workerPlan.review.connectorOutboundDirectedEdgeKeys,
				outbound.exclusiveCutEdges.map((cut) => staticFabOrganizationEdgeKey(cut.edge)),
			) ||
			!sameStringList(
				workerPlan.review.connectorReturnDirectedEdgeKeys,
				inbound.exclusiveCutEdges.map((cut) => staticFabOrganizationEdgeKey(cut.edge)),
			)
		) {
			throw new Error("Semantic Bay mutation review differs from its declared connector.");
		}
	}
	const planFingerprint = staticFabSemanticBayMutationPlanFingerprint(workerPlan);
	if (ticket.planFingerprint !== planFingerprint) {
		throw new Error("Semantic Bay mutation Worker plan fingerprint diverged.");
	}
	const adopted = copyWorkerPlan(workerPlan);
	if (staticFabSemanticBayMutationPlanFingerprint(adopted) !== planFingerprint) {
		throw new Error("Semantic Bay mutation plan changed during adoption.");
	}
	const certification = Object.freeze({ ...source, planFingerprint });
	issuedPlans.set(adopted, source);
	certifiedPlans.set(adopted, certification);
	return adopted;
}

function hasDeletedOrganizationAuthorization(plan: StaticFabSemanticBayMutationPlan): boolean {
	const deletedIds = new Set(
		plan.organizationMutations
			.filter((mutation) => mutation.before !== null && mutation.after === null)
			.map((mutation) => mutation.id),
	);
	return plan.organizationImpactAuthorizations.some((id) => deletedIds.has(id));
}

function sameStringList(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function isIssuedStaticFabSemanticBayMutationPlan(
	plan: StaticFabSemanticBayMutationPlan,
): boolean {
	return issuedPlans.has(plan);
}

export function isStaticFabSemanticBayMutationPlanIssuedFor(
	plan: StaticFabSemanticBayMutationPlan,
	map: TileMap,
	portEquipment: PortEquipmentState,
	organizations: StaticFabOrganizationState,
	relationships: StaticFabAssemblyRelationshipStateV1,
): boolean {
	const source = issuedPlans.get(plan);
	return (
		source?.map === map &&
		source.portEquipment === portEquipment &&
		source.organizations === organizations &&
		source.relationships === relationships
	);
}

export function consumeCertifiedStaticFabSemanticBayMutationPlanIssuedFor(
	plan: StaticFabSemanticBayMutationPlan,
	map: TileMap,
	portEquipment: PortEquipmentState,
	organizations: StaticFabOrganizationState,
	relationships: StaticFabAssemblyRelationshipStateV1,
): boolean {
	const certification = certifiedPlans.get(plan);
	if (
		certification?.map !== map ||
		certification.portEquipment !== portEquipment ||
		certification.organizations !== organizations ||
		certification.relationships !== relationships ||
		certification.sourceMapMutationGeneration !== map.getMutationGeneration() ||
		plan.nextRelationshipIdBefore !== relationships.nextRelationshipId ||
		plan.nextRelationshipIdAfter !== relationships.nextRelationshipId ||
		plan.baseRevision !== map.getRevision() ||
		certification.planFingerprint !== staticFabSemanticBayMutationPlanFingerprint(plan)
	) {
		return false;
	}
	certifiedPlans.delete(plan);
	issuedPlans.delete(plan);
	return true;
}

export function staticFabSemanticBayMutationPlanFingerprint(
	plan: StaticFabSemanticBayMutationPlan,
): string {
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings([
		"STATIC_FAB_SEMANTIC_BAY_MUTATION_PLAN",
		plan.kind,
		plan.reason,
		plan.issueCode ?? "",
	]);
	checksum.addNumbers([
		plan.baseRevision,
		plan.basePatchSequence,
		plan.nextOrganizationIdBefore,
		plan.nextOrganizationIdAfter,
		plan.nextRelationshipIdBefore,
		plan.nextRelationshipIdAfter,
		plan.valid ? 1 : 0,
	]);
	addRailMutations(checksum, plan.mutations);
	addAdvancedSwitchMutations(checksum, plan.switchMutations);
	addPortMutations(checksum, plan.portMutations);
	addEquipmentGroupMutations(checksum, plan.equipmentGroupMutations);
	addOrganizationMutations(checksum, plan.organizationMutations);
	checksum.addNumbers([plan.relationshipMutations.length]);
	for (const mutation of plan.relationshipMutations) {
		checksum.addNumbers([mutation.id]);
		for (const record of [mutation.before, mutation.after]) {
			checksum.addNumbers([record === null ? 0 : 1]);
			if (record) checksum.addStrings([checksumStaticFabAssemblyRelationshipRecord(record)]);
		}
	}
	checksum.addNumbers([
		plan.organizationImpactAuthorizations.length,
		...plan.organizationImpactAuthorizations,
	]);
	addReview(checksum, plan.review);
	return checksum.digest();
}

function copyWorkerPlan(plan: StaticFabSemanticBayMutationPlan): StaticFabSemanticBayMutationPlan {
	return Object.freeze({
		...plan,
		mutations: Object.freeze(plan.mutations.map((mutation) => Object.freeze({ ...mutation }))),
		switchMutations: Object.freeze(
			plan.switchMutations.map((mutation) =>
				Object.freeze({
					id: mutation.id,
					before: mutation.before ? copyAdvancedSwitch(mutation.before) : null,
					after: mutation.after ? copyAdvancedSwitch(mutation.after) : null,
				}),
			),
		),
		portMutations: Object.freeze(
			plan.portMutations.map((mutation) =>
				Object.freeze({
					id: mutation.id,
					before: mutation.before ? copyPortRecord(mutation.before) : null,
					after: mutation.after ? copyPortRecord(mutation.after) : null,
				}),
			),
		),
		equipmentGroupMutations: Object.freeze(
			plan.equipmentGroupMutations.map((mutation) =>
				Object.freeze({
					id: mutation.id,
					before: mutation.before ? copyEquipmentGroupRecord(mutation.before) : null,
					after: mutation.after ? copyEquipmentGroupRecord(mutation.after) : null,
				}),
			),
		),
		organizationMutations: Object.freeze(
			plan.organizationMutations.map((mutation) =>
				Object.freeze({
					id: mutation.id,
					before: mutation.before ? copyStaticFabOrganizationRecord(mutation.before) : null,
					after: mutation.after ? copyStaticFabOrganizationRecord(mutation.after) : null,
				}),
			),
		),
		organizationImpactAuthorizations: Object.freeze([...plan.organizationImpactAuthorizations]),
		relationshipMutations: Object.freeze(
			plan.relationshipMutations.map((mutation) =>
				Object.freeze({
					id: mutation.id,
					before: mutation.before ? copyStaticFabAssemblyRelationshipRecord(mutation.before) : null,
					after: mutation.after ? copyStaticFabAssemblyRelationshipRecord(mutation.after) : null,
				}),
			),
		),
		review: copyReview(plan.review),
	});
}

function copyReview(
	review: StaticFabSemanticBayMutationReview,
): StaticFabSemanticBayMutationReview {
	return Object.freeze({
		...review,
		removedOrganizationIds: Object.freeze([...review.removedOrganizationIds]),
		processLoopOrganizationIds: Object.freeze([...review.processLoopOrganizationIds]),
		railModuleKeys: Object.freeze([...review.railModuleKeys]),
		connectorOutboundDirectedEdgeKeys: Object.freeze([...review.connectorOutboundDirectedEdgeKeys]),
		connectorReturnDirectedEdgeKeys: Object.freeze([...review.connectorReturnDirectedEdgeKeys]),
		equipmentGroupIds: Object.freeze([...review.equipmentGroupIds]),
		portIds: Object.freeze([...review.portIds]),
	});
}

function addRailMutations(
	checksum: OrderedTypedChecksum,
	mutations: StaticFabSemanticBayMutationPlan["mutations"],
): void {
	checksum.addNumbers([mutations.length]);
	for (const mutation of mutations) {
		checksum.addNumbers([mutation.x, mutation.y, mutation.before, mutation.after]);
	}
}

function addAdvancedSwitchMutations(
	checksum: OrderedTypedChecksum,
	mutations: readonly AdvancedSwitchMutation[],
): void {
	checksum.addNumbers([mutations.length]);
	for (const mutation of mutations) {
		checksum.addNumbers([mutation.id]);
		addAdvancedSwitchRecord(checksum, mutation.before);
		addAdvancedSwitchRecord(checksum, mutation.after);
	}
}

function addAdvancedSwitchRecord(
	checksum: OrderedTypedChecksum,
	record: AdvancedSwitchRecord | null,
): void {
	if (!record) {
		checksum.addNumbers([0]);
		return;
	}
	checksum.addNumbers([
		1,
		record.id,
		record.origin.x,
		record.origin.y,
		record.forward,
		record.lateral,
		record.movementMask,
	]);
	checksum.addStrings([record.profileClass]);
}

function addPortMutations(
	checksum: OrderedTypedChecksum,
	mutations: readonly PortMutation[],
): void {
	checksum.addNumbers([mutations.length]);
	for (const mutation of mutations) {
		checksum.addNumbers([mutation.id]);
		addPortRecord(checksum, mutation.before);
		addPortRecord(checksum, mutation.after);
	}
}

function addPortRecord(checksum: OrderedTypedChecksum, record: PortRecord | null): void {
	if (!record) {
		checksum.addNumbers([0]);
		return;
	}
	checksum.addNumbers([
		1,
		record.id,
		record.equipmentGroupId,
		record.stationMillimeters,
		record.lateralOffsetMillimeters,
	]);
	checksum.addStrings([
		record.side,
		record.direction,
		record.portType,
		record.barcode ?? "",
		record.route.kind,
	]);
	if (record.route.kind === "CARDINAL_CELL") {
		checksum.addNumbers([record.route.x, record.route.z, record.route.from, record.route.to]);
	} else {
		checksum.addNumbers([
			record.route.switchId,
			record.route.portIndex ?? -1,
			record.route.segmentOrdinal,
		]);
		checksum.addStrings([record.route.profileClass, record.route.role]);
	}
}

function addEquipmentGroupMutations(
	checksum: OrderedTypedChecksum,
	mutations: readonly EquipmentGroupMutation[],
): void {
	checksum.addNumbers([mutations.length]);
	for (const mutation of mutations) {
		checksum.addNumbers([mutation.id]);
		addEquipmentGroupRecord(checksum, mutation.before);
		addEquipmentGroupRecord(checksum, mutation.after);
	}
}

function addEquipmentGroupRecord(
	checksum: OrderedTypedChecksum,
	record: EquipmentGroupRecord | null,
): void {
	if (!record) {
		checksum.addNumbers([0]);
		return;
	}
	checksum.addNumbers([1, record.id, record.portIds.length, ...record.portIds]);
	checksum.addStrings([record.kind]);
	if (record.kind === "EQ") {
		checksum.addNumbers([record.pitchMillimeters]);
		checksum.addStrings([record.recipe ?? ""]);
	} else {
		checksum.addStrings([record.template]);
	}
}

function addOrganizationMutations(
	checksum: OrderedTypedChecksum,
	mutations: readonly StaticFabOrganizationMutation[],
): void {
	checksum.addNumbers([mutations.length]);
	for (const mutation of mutations) {
		checksum.addNumbers([mutation.id]);
		addOrganizationRecord(checksum, mutation.before);
		addOrganizationRecord(checksum, mutation.after);
	}
}

function addOrganizationRecord(
	checksum: OrderedTypedChecksum,
	record: StaticFabOrganizationRecord | null,
): void {
	if (!record) {
		checksum.addNumbers([0]);
		return;
	}
	const parents = staticFabOrganizationParentIds(record);
	const properties = staticFabOrganizationProperties(record);
	checksum.addNumbers([1, record.id, parents.length, ...parents]);
	checksum.addStrings([record.kind, record.name, properties.description, properties.color]);
	const declaredRole = staticFabOrganizationDeclaredSemanticRole(record);
	if (declaredRole !== null) checksum.addStrings(["declaredSemanticRole", declaredRole]);
	checksum.addNumbers([record.membership.railEdges.length]);
	for (const edge of record.membership.railEdges) {
		checksum.addNumbers([edge.from.x, edge.from.y, edge.to.x, edge.to.y]);
	}
	checksum.addNumbers([
		record.membership.advancedSwitchIds.length,
		...record.membership.advancedSwitchIds,
		record.membership.equipmentGroupIds.length,
		...record.membership.equipmentGroupIds,
	]);
}

function addReview(
	checksum: OrderedTypedChecksum,
	review: StaticFabSemanticBayMutationReview,
): void {
	checksum.addStrings([
		review.action,
		review.bayName,
		review.circulationCertification,
		review.issueCode ?? "",
	]);
	checksum.addNumbers([
		review.version,
		review.bayOrganizationId,
		review.bankOrganizationId ?? 0,
		review.processLoopCount,
		review.railModuleCount,
		review.bayDirectedEdgeCount,
		review.incidentConnectorCount,
		review.connectorDirectedEdgeCount,
		review.advancedSwitchCount,
		review.equipmentGroupCount,
		review.portCount,
		review.remainingBankDirectedEdgeCount,
		review.retainedCirculationCandidatePresent ? 1 : 0,
	]);
	addNumberList(checksum, review.removedOrganizationIds);
	addNumberList(checksum, review.processLoopOrganizationIds);
	addStringList(checksum, review.railModuleKeys);
	addStringList(checksum, review.connectorOutboundDirectedEdgeKeys);
	addStringList(checksum, review.connectorReturnDirectedEdgeKeys);
	addNumberList(checksum, review.equipmentGroupIds);
	addNumberList(checksum, review.portIds);
}

function addNumberList(checksum: OrderedTypedChecksum, values: readonly number[]): void {
	checksum.addNumbers([values.length, ...values]);
}

function addStringList(checksum: OrderedTypedChecksum, values: readonly string[]): void {
	checksum.addNumbers([values.length]);
	checksum.addStrings(values);
}
