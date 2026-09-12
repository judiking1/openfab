import {
	type AdvancedSwitchMutation,
	type AdvancedSwitchRecord,
	copyAdvancedSwitch,
} from "./AdvancedSwitch";
import { completeCooperativeSteps, createCooperativeTask } from "./CooperativeTask";
import {
	copyEquipmentGroupRecord,
	type EquipmentGroupMutation,
	type EquipmentGroupRecord,
	type PortEquipmentState,
} from "./EquipmentGroup";
import { freezeTransferDataContainersSteps } from "./ImmutableDataContainers";
import { OrderedTypedChecksum } from "./OrderedTypedChecksum";
import { copyPortRecord, type PortMutation, type PortRecord } from "./PortRecord";
import {
	type StaticFabArrangementCommandIntent,
	staticFabArrangementCommandFingerprint,
} from "./StaticFabArrangementCommand";
import {
	STATIC_FAB_ARRANGEMENT_PLAN_KIND,
	type StaticFabArrangementPlan,
} from "./StaticFabArrangementPlan";
import {
	checksumStaticFabAssemblyRelationshipRecord,
	checksumStaticFabAssemblyRelationshipRecordSteps,
	copyStaticFabAssemblyRelationshipRecordSteps,
	type StaticFabAssemblyRelationshipMutationV1,
	type StaticFabAssemblyRelationshipStateV1,
} from "./StaticFabAssemblyRelationship";
import {
	createCanonicalStaticFabOrganizationStateBuilder,
	type StaticFabOrganizationMutation,
	type StaticFabOrganizationRecord,
	type StaticFabOrganizationState,
	staticFabOrganizationParentIds,
	staticFabOrganizationProperties,
} from "./StaticFabOrganization";
import type { TileMap } from "./TileMap";

export interface StaticFabArrangementWorkerTicket {
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

/** Opaque one-shot authority retained by the main thread while a disposable Worker validates. */
export interface StaticFabArrangementPermit {
	readonly ticketId: number;
}

interface ArrangementSource {
	readonly map: TileMap;
	readonly portEquipment: PortEquipmentState;
	readonly organizations: StaticFabOrganizationState;
	readonly relationships: StaticFabAssemblyRelationshipStateV1;
	readonly sourceMapMutationGeneration: number;
	readonly sourceChecksum: string;
}

interface ArrangementPermitSource extends ArrangementSource {
	readonly baseRevision: number;
	readonly basePatchSequence: number;
	readonly sourceNextAdvancedSwitchId: number;
	readonly sourceNextPortId: number;
	readonly sourceNextEquipmentGroupId: number;
	readonly sourceNextOrganizationId: number;
	readonly sourceNextRelationshipId: number;
	readonly intentFingerprint: string;
}

const issuedPlans = new WeakMap<object, ArrangementSource>();
const certifiedPlans = new WeakMap<
	object,
	ArrangementSource & { readonly planFingerprint: string }
>();
const pendingPermits = new WeakMap<object, ArrangementPermitSource>();
const adoptingPermits = new WeakMap<object, ArrangementPermitSource>();
const ownedPlanFingerprints = new WeakMap<object, string>();
let nextTicketId = 1;

export function issueStaticFabArrangementPermit(
	map: TileMap,
	portEquipment: PortEquipmentState,
	patchSequence: number,
	organizations: StaticFabOrganizationState,
	relationships: StaticFabAssemblyRelationshipStateV1,
	intent: StaticFabArrangementCommandIntent,
	sourceChecksum: string,
): StaticFabArrangementPermit {
	if (!Number.isSafeInteger(patchSequence) || patchSequence < 0) {
		throw new RangeError("Static FAB arrangement patch sequence is invalid.");
	}
	if (typeof sourceChecksum !== "string" || sourceChecksum.length === 0) {
		throw new TypeError("Static FAB arrangement source checksum is missing.");
	}
	if (!Number.isSafeInteger(nextTicketId)) {
		throw new RangeError("Static FAB arrangement ticket sequence is exhausted.");
	}
	const permit = Object.freeze({ ticketId: nextTicketId++ });
	pendingPermits.set(
		permit,
		Object.freeze({
			map,
			portEquipment,
			organizations,
			relationships,
			sourceMapMutationGeneration: map.getMutationGeneration(),
			sourceChecksum,
			baseRevision: map.getRevision(),
			basePatchSequence: patchSequence,
			sourceNextAdvancedSwitchId: map.getAdvancedSwitchIdCursor(),
			sourceNextPortId: portEquipment.nextPortId,
			sourceNextEquipmentGroupId: portEquipment.nextEquipmentGroupId,
			sourceNextOrganizationId: organizations.nextOrganizationId,
			sourceNextRelationshipId: relationships.nextRelationshipId,
			intentFingerprint: staticFabArrangementCommandFingerprint(intent),
		}),
	);
	return permit;
}

export function revokeStaticFabArrangementPermit(permit: StaticFabArrangementPermit): void {
	pendingPermits.delete(permit);
	adoptingPermits.delete(permit);
}

/** Adopt an exact Worker result once, binding it to the current live authored object identities. */
export function adoptStaticFabArrangementWorkerPlan(
	permit: StaticFabArrangementPermit,
	ticket: StaticFabArrangementWorkerTicket,
	workerPlan: StaticFabArrangementPlan,
	expectedProspectiveChecksum: string,
	map: TileMap,
	portEquipment: PortEquipmentState,
	patchSequence: number,
	organizations: StaticFabOrganizationState,
	relationships: StaticFabAssemblyRelationshipStateV1,
	intent: StaticFabArrangementCommandIntent,
): StaticFabArrangementPlan {
	const source = pendingPermits.get(permit);
	pendingPermits.delete(permit);
	if (!source) throw new Error("Static FAB arrangement permit is missing or already consumed.");
	const intentFingerprint = staticFabArrangementCommandFingerprint(intent);
	if (
		source.map !== map ||
		source.portEquipment !== portEquipment ||
		source.organizations !== organizations ||
		source.relationships !== relationships ||
		source.sourceMapMutationGeneration !== map.getMutationGeneration() ||
		source.baseRevision !== map.getRevision() ||
		source.basePatchSequence !== patchSequence ||
		source.sourceNextAdvancedSwitchId !== map.getAdvancedSwitchIdCursor() ||
		source.sourceNextPortId !== portEquipment.nextPortId ||
		source.sourceNextEquipmentGroupId !== portEquipment.nextEquipmentGroupId ||
		source.sourceNextOrganizationId !== organizations.nextOrganizationId ||
		source.sourceNextRelationshipId !== relationships.nextRelationshipId ||
		source.intentFingerprint !== intentFingerprint
	) {
		throw new Error("Static FAB arrangement permit no longer matches the live document.");
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
		throw new Error("Static FAB arrangement Worker ticket does not match its one-shot permit.");
	}
	if (
		!workerPlan.valid ||
		workerPlan.kind !== STATIC_FAB_ARRANGEMENT_PLAN_KIND ||
		workerPlan.baseRevision !== source.baseRevision ||
		workerPlan.basePatchSequence !== source.basePatchSequence ||
		workerPlan.nextOrganizationIdBefore !== source.sourceNextOrganizationId ||
		workerPlan.nextOrganizationIdAfter !== source.sourceNextOrganizationId ||
		workerPlan.nextRelationshipIdBefore !== source.sourceNextRelationshipId ||
		workerPlan.nextRelationshipIdAfter !== source.sourceNextRelationshipId
	) {
		throw new Error("Static FAB arrangement Worker plan is stale or invalid.");
	}
	const planFingerprint = staticFabArrangementPlanFingerprint(workerPlan);
	if (ticket.planFingerprint !== planFingerprint) {
		throw new Error("Static FAB arrangement Worker plan fingerprint diverged.");
	}
	const adopted = copyWorkerPlan(workerPlan);
	if (staticFabArrangementPlanFingerprint(adopted) !== planFingerprint) {
		throw new Error("Static FAB arrangement plan changed during adoption.");
	}
	const certification = Object.freeze({ ...source, planFingerprint });
	ownedPlanFingerprints.set(adopted, planFingerprint);
	issuedPlans.set(adopted, source);
	certifiedPlans.set(adopted, certification);
	return adopted;
}

/** Adopt a revocable exact plan without blocking on wide membership or relationship records. */
export async function adoptStaticFabArrangementWorkerPlanCooperatively(
	permit: StaticFabArrangementPermit,
	inputTicket: StaticFabArrangementWorkerTicket,
	workerPlan: StaticFabArrangementPlan,
	expectedProspectiveChecksum: string,
	map: TileMap,
	portEquipment: PortEquipmentState,
	patchSequence: number,
	organizations: StaticFabOrganizationState,
	relationships: StaticFabAssemblyRelationshipStateV1,
	intent: StaticFabArrangementCommandIntent,
	checkpoint: () => Promise<void>,
	operationBudget = 128,
): Promise<StaticFabArrangementPlan> {
	const source = pendingPermits.get(permit);
	pendingPermits.delete(permit);
	if (!source) throw new Error("Static FAB arrangement permit is missing or already consumed.");
	if (!Number.isSafeInteger(operationBudget) || operationBudget <= 0)
		throw new RangeError("Arrangement adoption operation budget must be positive.");
	const ticket = Object.freeze({ ...inputTicket });
	adoptingPermits.set(permit, source);
	const current = () =>
		adoptingPermits.get(permit) === source &&
		source.map === map &&
		source.portEquipment === portEquipment &&
		source.organizations === organizations &&
		source.relationships === relationships &&
		source.sourceMapMutationGeneration === map.getMutationGeneration() &&
		source.baseRevision === map.getRevision() &&
		source.sourceNextAdvancedSwitchId === map.getAdvancedSwitchIdCursor() &&
		source.sourceNextPortId === portEquipment.nextPortId &&
		source.sourceNextEquipmentGroupId === portEquipment.nextEquipmentGroupId &&
		source.sourceNextOrganizationId === organizations.nextOrganizationId &&
		source.sourceNextRelationshipId === relationships.nextRelationshipId;
	const check = async () => {
		if (!current()) throw new Error("Arrangement adoption became stale or was cancelled.");
		await checkpoint();
		if (!current()) throw new Error("Arrangement adoption became stale or was cancelled.");
	};
	const finish = async <T>(steps: Generator<void, T>): Promise<T> => {
		const task = createCooperativeTask(steps);
		while (!task.done) {
			task.step(operationBudget);
			await check();
		}
		return task.finish();
	};
	try {
		const intentFingerprint = staticFabArrangementCommandFingerprint(intent);
		if (
			source.map !== map ||
			source.portEquipment !== portEquipment ||
			source.organizations !== organizations ||
			source.relationships !== relationships ||
			source.sourceMapMutationGeneration !== map.getMutationGeneration() ||
			source.baseRevision !== map.getRevision() ||
			source.basePatchSequence !== patchSequence ||
			source.sourceNextAdvancedSwitchId !== map.getAdvancedSwitchIdCursor() ||
			source.sourceNextPortId !== portEquipment.nextPortId ||
			source.sourceNextEquipmentGroupId !== portEquipment.nextEquipmentGroupId ||
			source.sourceNextOrganizationId !== organizations.nextOrganizationId ||
			source.sourceNextRelationshipId !== relationships.nextRelationshipId ||
			source.intentFingerprint !== intentFingerprint
		) {
			throw new Error("Static FAB arrangement permit no longer matches the live document.");
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
			throw new Error("Static FAB arrangement Worker ticket does not match its one-shot permit.");
		}
		if (
			!workerPlan.valid ||
			workerPlan.kind !== STATIC_FAB_ARRANGEMENT_PLAN_KIND ||
			workerPlan.baseRevision !== source.baseRevision ||
			workerPlan.basePatchSequence !== source.basePatchSequence ||
			workerPlan.nextOrganizationIdBefore !== source.sourceNextOrganizationId ||
			workerPlan.nextOrganizationIdAfter !== source.sourceNextOrganizationId ||
			workerPlan.nextRelationshipIdBefore !== source.sourceNextRelationshipId ||
			workerPlan.nextRelationshipIdAfter !== source.sourceNextRelationshipId
		) {
			throw new Error("Static FAB arrangement Worker plan is stale or invalid.");
		}
		const adopted = await finish(copyStaticFabArrangementWorkerPlanSteps(workerPlan));
		const planFingerprint = await finish(staticFabArrangementPlanFingerprintSteps(adopted));
		if (ticket.planFingerprint !== planFingerprint)
			throw new Error("Static FAB arrangement Worker plan fingerprint diverged.");
		await check();
		const certification = Object.freeze({ ...source, planFingerprint });
		ownedPlanFingerprints.set(adopted, planFingerprint);
		issuedPlans.set(adopted, source);
		certifiedPlans.set(adopted, certification);
		return adopted;
	} finally {
		adoptingPermits.delete(permit);
	}
}

export function isIssuedStaticFabArrangementPlan(plan: StaticFabArrangementPlan): boolean {
	return issuedPlans.has(plan);
}

export function isStaticFabArrangementPlanIssuedFor(
	plan: StaticFabArrangementPlan,
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
		source.relationships === relationships &&
		source.sourceMapMutationGeneration === map.getMutationGeneration()
	);
}

export function consumeCertifiedStaticFabArrangementPlanIssuedFor(
	plan: StaticFabArrangementPlan,
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
		plan.baseRevision !== map.getRevision() ||
		certification.planFingerprint !== ownedPlanFingerprints.get(plan)
	) {
		return false;
	}
	certifiedPlans.delete(plan);
	issuedPlans.delete(plan);
	ownedPlanFingerprints.delete(plan);
	return true;
}

export function staticFabArrangementPlanFingerprint(plan: StaticFabArrangementPlan): string {
	return completeCooperativeSteps(arrangementPlanFingerprintSteps(plan, false));
}

export function* staticFabArrangementPlanFingerprintSteps(
	plan: StaticFabArrangementPlan,
): Generator<void, string> {
	return yield* arrangementPlanFingerprintSteps(plan, true);
}

function* arrangementPlanFingerprintSteps(
	plan: StaticFabArrangementPlan,
	immutableRelationships: boolean,
): Generator<void, string> {
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings([
		"STATIC_FAB_ARRANGEMENT_PLAN",
		plan.kind,
		plan.issueCode ?? "",
		plan.arrangement?.axis ?? "",
		plan.arrangement?.mode ?? "",
	]);
	checksum.addNumbers([
		plan.baseRevision,
		plan.basePatchSequence,
		plan.nextOrganizationIdBefore,
		plan.nextOrganizationIdAfter,
		plan.nextRelationshipIdBefore,
		plan.nextRelationshipIdAfter,
		plan.valid ? 1 : 0,
		plan.cells.length,
		plan.conflicts.length,
		plan.mutations.length,
		plan.organizationImpactAuthorizations.length,
	]);
	yield* checksum.addNumberSequenceSteps(plan.cells.length * 2, (index) =>
		index % 2 === 0 ? plan.cells[Math.floor(index / 2)].x : plan.cells[Math.floor(index / 2)].y,
	);
	yield* checksum.addNumberSequenceSteps(plan.conflicts.length * 2, (index) =>
		index % 2 === 0
			? plan.conflicts[Math.floor(index / 2)].x
			: plan.conflicts[Math.floor(index / 2)].y,
	);
	yield* checksum.addNumberSequenceSteps(plan.mutations.length * 4, (index) => {
		const mutation = plan.mutations[Math.floor(index / 4)];
		return [mutation.x, mutation.y, mutation.before, mutation.after][index % 4];
	});
	yield* addAdvancedSwitchMutations(checksum, plan.switchMutations);
	yield* addPortMutations(checksum, plan.portMutations);
	yield* addEquipmentGroupMutations(checksum, plan.equipmentGroupMutations);
	yield* addOrganizationMutations(checksum, plan.organizationMutations);
	yield* addRelationshipMutations(checksum, plan.relationshipMutations, immutableRelationships);
	yield* checksum.addNumbersSteps(plan.organizationImpactAuthorizations);
	if (plan.arrangement) {
		yield* checksum.addNumbersSteps([
			plan.arrangement.version,
			plan.arrangement.maximumSnapErrorMeters,
			plan.arrangement.rootCount,
			plan.arrangement.moduleCount,
			plan.arrangement.railEdgeCount,
			plan.arrangement.advancedSwitchCount,
			plan.arrangement.portCount,
			plan.arrangement.equipmentGroupCount,
			plan.arrangement.translations.length,
			plan.arrangement.affectedOrganizationIds.length,
			...plan.arrangement.affectedOrganizationIds,
		]);
		for (const translation of plan.arrangement.translations) {
			yield;
			checksum.addStrings([translation.key]);
			checksum.addNumbers([
				translation.deltaX,
				translation.deltaZ,
				translation.before.minX,
				translation.before.minZ,
				translation.before.maxXExclusive,
				translation.before.maxZExclusive,
				translation.after.minX,
				translation.after.minZ,
				translation.after.maxXExclusive,
				translation.after.maxZExclusive,
			]);
		}
	}
	return checksum.digest();
}

function copyWorkerPlan(plan: StaticFabArrangementPlan): StaticFabArrangementPlan {
	return completeCooperativeSteps(copyStaticFabArrangementWorkerPlanSteps(plan));
}

/** Copy validated Worker data into owned canonical records; this grants no commit authority. */
export function* copyStaticFabArrangementWorkerPlanSteps(
	plan: StaticFabArrangementPlan,
): Generator<void, StaticFabArrangementPlan> {
	// Parent references are secured before traversing the received relationship graph.
	yield* freezeTransferDataContainersSteps(plan.relationshipMutations);
	const cells = [],
		conflicts = [],
		mutations = [],
		switches = [],
		ports = [],
		groups = [],
		organizations = [],
		relationships = [],
		authorizations = [];
	for (const cell of plan.cells) {
		yield;
		cells.push(Object.freeze({ x: cell.x, y: cell.y }));
	}
	for (const cell of plan.conflicts) {
		yield;
		conflicts.push(Object.freeze({ x: cell.x, y: cell.y }));
	}
	for (const change of plan.mutations) {
		yield;
		mutations.push(Object.freeze({ ...change }));
	}
	for (const change of plan.switchMutations) {
		yield;
		switches.push(
			Object.freeze({
				id: change.id,
				before: change.before ? copyAdvancedSwitch(change.before) : null,
				after: change.after ? copyAdvancedSwitch(change.after) : null,
			}),
		);
	}
	for (const change of plan.portMutations) {
		yield;
		ports.push(
			Object.freeze({
				id: change.id,
				before: change.before ? copyPortRecord(change.before) : null,
				after: change.after ? copyPortRecord(change.after) : null,
			}),
		);
	}
	for (const change of plan.equipmentGroupMutations) {
		yield;
		groups.push(
			Object.freeze({
				id: change.id,
				before: change.before ? copyEquipmentGroupRecord(change.before) : null,
				after: change.after ? copyEquipmentGroupRecord(change.after) : null,
			}),
		);
	}
	for (const change of plan.organizationMutations) {
		yield;
		organizations.push(
			Object.freeze({
				id: change.id,
				before: change.before ? yield* copyOrganizationSteps(change.before) : null,
				after: change.after ? yield* copyOrganizationSteps(change.after) : null,
			}),
		);
	}
	for (const change of plan.relationshipMutations) {
		yield;
		relationships.push(
			Object.freeze({
				id: change.id,
				before: change.before
					? yield* copyStaticFabAssemblyRelationshipRecordSteps(change.before)
					: null,
				after: change.after
					? yield* copyStaticFabAssemblyRelationshipRecordSteps(change.after)
					: null,
			}),
		);
	}
	for (const id of plan.organizationImpactAuthorizations) {
		yield;
		authorizations.push(id);
	}
	const translations = [],
		affectedOrganizationIds = [];
	if (plan.arrangement) {
		for (const translation of plan.arrangement.translations) {
			yield;
			translations.push(
				Object.freeze({
					...translation,
					before: Object.freeze({ ...translation.before }),
					after: Object.freeze({ ...translation.after }),
				}),
			);
		}
		for (const id of plan.arrangement.affectedOrganizationIds) {
			yield;
			affectedOrganizationIds.push(id);
		}
	}
	return Object.freeze({
		...plan,
		cells: Object.freeze(cells),
		conflicts: Object.freeze(conflicts),
		mutations: Object.freeze(mutations),
		switchMutations: Object.freeze(switches),
		portMutations: Object.freeze(ports),
		equipmentGroupMutations: Object.freeze(groups),
		organizationMutations: Object.freeze(organizations),
		relationshipMutations: Object.freeze(relationships),
		organizationImpactAuthorizations: Object.freeze(authorizations),
		arrangement: plan.arrangement
			? Object.freeze({
					...plan.arrangement,
					translations: Object.freeze(translations),
					affectedOrganizationIds: Object.freeze(affectedOrganizationIds),
				})
			: null,
	});
}

function* copyOrganizationSteps(
	record: StaticFabOrganizationRecord,
): Generator<void, StaticFabOrganizationRecord> {
	const builder = createCanonicalStaticFabOrganizationStateBuilder(record.id + 1);
	const properties = staticFabOrganizationProperties(record);
	for (const id of staticFabOrganizationParentIds(record)) {
		yield;
		builder.addParentOrganizationId(id);
	}
	for (const edge of record.membership.railEdges) {
		yield;
		builder.addRailEdge(edge);
	}
	for (const id of record.membership.advancedSwitchIds) {
		yield;
		builder.addAdvancedSwitchId(id);
	}
	for (const id of record.membership.equipmentGroupIds) {
		yield;
		builder.addEquipmentGroupId(id);
	}
	builder.finishRecord({
		id: record.id,
		kind: record.kind,
		name: record.name,
		description: properties.description,
		color: properties.color,
	});
	const copied = builder.finish().records[0];
	if (!copied) throw new Error("Missing adopted arrangement organization.");
	return copied;
}

function* addAdvancedSwitchMutations(
	checksum: OrderedTypedChecksum,
	mutations: readonly AdvancedSwitchMutation[],
): Generator<void> {
	checksum.addNumbers([mutations.length]);
	for (const mutation of mutations) {
		yield;
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

function* addPortMutations(
	checksum: OrderedTypedChecksum,
	mutations: readonly PortMutation[],
): Generator<void> {
	checksum.addNumbers([mutations.length]);
	for (const mutation of mutations) {
		yield;
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

function* addEquipmentGroupMutations(
	checksum: OrderedTypedChecksum,
	mutations: readonly EquipmentGroupMutation[],
): Generator<void> {
	checksum.addNumbers([mutations.length]);
	for (const mutation of mutations) {
		yield;
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
	} else checksum.addStrings([record.template]);
}

function* addOrganizationMutations(
	checksum: OrderedTypedChecksum,
	mutations: readonly StaticFabOrganizationMutation[],
): Generator<void> {
	checksum.addNumbers([mutations.length]);
	for (const mutation of mutations) {
		yield;
		checksum.addNumbers([mutation.id]);
		yield* addOrganizationRecord(checksum, mutation.before);
		yield* addOrganizationRecord(checksum, mutation.after);
	}
}

function* addOrganizationRecord(
	checksum: OrderedTypedChecksum,
	record: StaticFabOrganizationRecord | null,
): Generator<void> {
	if (!record) {
		checksum.addNumbers([0]);
		return;
	}
	checksum.addNumbers([
		1,
		record.id,
		(record.parentOrganizationIds ?? []).length,
		...(record.parentOrganizationIds ?? []),
	]);
	checksum.addStrings([
		record.kind,
		record.name,
		record.properties?.description ?? "",
		record.properties?.color ?? "",
	]);
	const membership = record.membership;
	const edgeScalars = membership.railEdges.length * 4;
	yield* checksum.addNumberSequenceSteps(
		3 + edgeScalars + membership.advancedSwitchIds.length + membership.equipmentGroupIds.length,
		(index) => {
			if (index === 0) return membership.railEdges.length;
			index--;
			if (index < edgeScalars) {
				const edge = membership.railEdges[Math.floor(index / 4)];
				return [edge.from.x, edge.from.y, edge.to.x, edge.to.y][index % 4];
			}
			index -= edgeScalars;
			if (index === 0) return membership.advancedSwitchIds.length;
			index--;
			if (index < membership.advancedSwitchIds.length) return membership.advancedSwitchIds[index];
			index -= membership.advancedSwitchIds.length;
			if (index === 0) return membership.equipmentGroupIds.length;
			return membership.equipmentGroupIds[index - 1];
		},
	);
}

function* addRelationshipMutations(
	checksum: OrderedTypedChecksum,
	changes: readonly StaticFabAssemblyRelationshipMutationV1[],
	immutable: boolean,
): Generator<void> {
	checksum.addNumbers([changes.length]);
	for (const change of changes) {
		yield;
		checksum.addNumbers([change.id]);
		for (const record of [change.before, change.after]) {
			checksum.addNumbers([record ? 1 : 0]);
			if (record)
				checksum.addStrings([
					immutable
						? yield* checksumStaticFabAssemblyRelationshipRecordSteps(record)
						: checksumStaticFabAssemblyRelationshipRecord(record),
				]);
		}
	}
}
