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
	copyStaticFabOrganizationRecord,
	type StaticFabOrganizationMutation,
	type StaticFabOrganizationRecord,
	type StaticFabOrganizationState,
	staticFabOrganizationParentIds,
	staticFabOrganizationProperties,
} from "./StaticFabOrganization";
import {
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
	readonly intentFingerprint: string;
	readonly planFingerprint: string;
	readonly prospectiveChecksum: string;
	readonly prospectiveNextAdvancedSwitchId: number;
	readonly prospectiveNextPortId: number;
	readonly prospectiveNextEquipmentGroupId: number;
	readonly prospectiveNextOrganizationId: number;
}

/** Opaque main-realm authority for one source-bound disposable Worker request. */
export interface StaticFabSemanticBayMutationPermit {
	readonly ticketId: number;
}

interface SemanticBayMutationSource {
	readonly map: TileMap;
	readonly portEquipment: PortEquipmentState;
	readonly organizations: StaticFabOrganizationState;
	readonly sourceChecksum: string;
}

interface SemanticBayMutationPermitSource extends SemanticBayMutationSource {
	readonly baseRevision: number;
	readonly basePatchSequence: number;
	readonly sourceNextAdvancedSwitchId: number;
	readonly sourceNextPortId: number;
	readonly sourceNextEquipmentGroupId: number;
	readonly sourceNextOrganizationId: number;
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
			sourceChecksum,
			baseRevision: map.getRevision(),
			basePatchSequence: patchSequence,
			sourceNextAdvancedSwitchId: map.getAdvancedSwitchIdCursor(),
			sourceNextPortId: portEquipment.nextPortId,
			sourceNextEquipmentGroupId: portEquipment.nextEquipmentGroupId,
			sourceNextOrganizationId: organizations.nextOrganizationId,
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
): StaticFabSemanticBayMutationPlan {
	const source = pendingPermits.get(permit);
	pendingPermits.delete(permit);
	if (!source) throw new Error("Semantic Bay mutation permit is missing or already consumed.");
	const intentFingerprint = staticFabSemanticBayMutationIntentFingerprint(intent);
	if (
		source.map !== map ||
		source.portEquipment !== portEquipment ||
		source.organizations !== organizations ||
		source.baseRevision !== map.getRevision() ||
		source.basePatchSequence !== patchSequence ||
		source.sourceNextAdvancedSwitchId !== map.getAdvancedSwitchIdCursor() ||
		source.sourceNextPortId !== portEquipment.nextPortId ||
		source.sourceNextEquipmentGroupId !== portEquipment.nextEquipmentGroupId ||
		source.sourceNextOrganizationId !== organizations.nextOrganizationId ||
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
		ticket.intentFingerprint !== intentFingerprint ||
		ticket.prospectiveNextAdvancedSwitchId !== source.sourceNextAdvancedSwitchId ||
		ticket.prospectiveNextPortId !== source.sourceNextPortId ||
		ticket.prospectiveNextEquipmentGroupId !== source.sourceNextEquipmentGroupId ||
		ticket.prospectiveNextOrganizationId !== source.sourceNextOrganizationId ||
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
		workerPlan.issueCode !== null ||
		workerPlan.review.action !== intent.action ||
		workerPlan.review.bayOrganizationId !== intent.bayOrganizationId ||
		workerPlan.review.issueCode !== null ||
		workerPlan.review.circulationCertification !== "PENDING_WORKER_CERTIFICATION" ||
		hasDeletedOrganizationAuthorization(workerPlan)
	) {
		throw new Error("Semantic Bay mutation Worker plan is stale or invalid.");
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
): boolean {
	const source = issuedPlans.get(plan);
	return (
		source?.map === map &&
		source.portEquipment === portEquipment &&
		source.organizations === organizations
	);
}

export function consumeCertifiedStaticFabSemanticBayMutationPlanIssuedFor(
	plan: StaticFabSemanticBayMutationPlan,
	map: TileMap,
	portEquipment: PortEquipmentState,
	organizations: StaticFabOrganizationState,
): boolean {
	const certification = certifiedPlans.get(plan);
	if (
		certification?.map !== map ||
		certification.portEquipment !== portEquipment ||
		certification.organizations !== organizations ||
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
		plan.valid ? 1 : 0,
	]);
	addRailMutations(checksum, plan.mutations);
	addAdvancedSwitchMutations(checksum, plan.switchMutations);
	addPortMutations(checksum, plan.portMutations);
	addEquipmentGroupMutations(checksum, plan.equipmentGroupMutations);
	addOrganizationMutations(checksum, plan.organizationMutations);
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
