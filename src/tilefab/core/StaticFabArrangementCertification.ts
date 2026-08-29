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
	type StaticFabArrangementCommandIntent,
	staticFabArrangementCommandFingerprint,
} from "./StaticFabArrangementCommand";
import {
	STATIC_FAB_ARRANGEMENT_PLAN_KIND,
	type StaticFabArrangementPlan,
} from "./StaticFabArrangementPlan";
import {
	copyStaticFabOrganizationRecord,
	type StaticFabOrganizationMutation,
	type StaticFabOrganizationRecord,
	type StaticFabOrganizationState,
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
	readonly intentFingerprint: string;
	readonly planFingerprint: string;
	readonly prospectiveChecksum: string;
	readonly prospectiveNextAdvancedSwitchId: number;
	readonly prospectiveNextPortId: number;
	readonly prospectiveNextEquipmentGroupId: number;
	readonly prospectiveNextOrganizationId: number;
}

/** Opaque one-shot authority retained by the main thread while a disposable Worker validates. */
export interface StaticFabArrangementPermit {
	readonly ticketId: number;
}

interface ArrangementSource {
	readonly map: TileMap;
	readonly portEquipment: PortEquipmentState;
	readonly organizations: StaticFabOrganizationState;
	readonly sourceChecksum: string;
}

interface ArrangementPermitSource extends ArrangementSource {
	readonly baseRevision: number;
	readonly basePatchSequence: number;
	readonly sourceNextAdvancedSwitchId: number;
	readonly sourceNextPortId: number;
	readonly sourceNextEquipmentGroupId: number;
	readonly sourceNextOrganizationId: number;
	readonly intentFingerprint: string;
}

const issuedPlans = new WeakMap<object, ArrangementSource>();
const certifiedPlans = new WeakMap<
	object,
	ArrangementSource & { readonly planFingerprint: string }
>();
const pendingPermits = new WeakMap<object, ArrangementPermitSource>();
let nextTicketId = 1;

export function issueStaticFabArrangementPermit(
	map: TileMap,
	portEquipment: PortEquipmentState,
	patchSequence: number,
	organizations: StaticFabOrganizationState,
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
			sourceChecksum,
			baseRevision: map.getRevision(),
			basePatchSequence: patchSequence,
			sourceNextAdvancedSwitchId: map.getAdvancedSwitchIdCursor(),
			sourceNextPortId: portEquipment.nextPortId,
			sourceNextEquipmentGroupId: portEquipment.nextEquipmentGroupId,
			sourceNextOrganizationId: organizations.nextOrganizationId,
			intentFingerprint: staticFabArrangementCommandFingerprint(intent),
		}),
	);
	return permit;
}

export function revokeStaticFabArrangementPermit(permit: StaticFabArrangementPermit): void {
	pendingPermits.delete(permit);
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
		source.baseRevision !== map.getRevision() ||
		source.basePatchSequence !== patchSequence ||
		source.sourceNextAdvancedSwitchId !== map.getAdvancedSwitchIdCursor() ||
		source.sourceNextPortId !== portEquipment.nextPortId ||
		source.sourceNextEquipmentGroupId !== portEquipment.nextEquipmentGroupId ||
		source.sourceNextOrganizationId !== organizations.nextOrganizationId ||
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
		ticket.intentFingerprint !== intentFingerprint ||
		ticket.prospectiveNextAdvancedSwitchId !== source.sourceNextAdvancedSwitchId ||
		ticket.prospectiveNextPortId !== source.sourceNextPortId ||
		ticket.prospectiveNextEquipmentGroupId !== source.sourceNextEquipmentGroupId ||
		ticket.prospectiveNextOrganizationId !== source.sourceNextOrganizationId ||
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
		workerPlan.nextOrganizationIdAfter !== source.sourceNextOrganizationId
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
	issuedPlans.set(adopted, source);
	certifiedPlans.set(adopted, certification);
	return adopted;
}

export function isIssuedStaticFabArrangementPlan(plan: StaticFabArrangementPlan): boolean {
	return issuedPlans.has(plan);
}

export function isStaticFabArrangementPlanIssuedFor(
	plan: StaticFabArrangementPlan,
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

export function consumeCertifiedStaticFabArrangementPlanIssuedFor(
	plan: StaticFabArrangementPlan,
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
		certification.planFingerprint !== staticFabArrangementPlanFingerprint(plan)
	) {
		return false;
	}
	certifiedPlans.delete(plan);
	issuedPlans.delete(plan);
	return true;
}

export function staticFabArrangementPlanFingerprint(plan: StaticFabArrangementPlan): string {
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
		plan.valid ? 1 : 0,
		plan.cells.length,
		plan.conflicts.length,
		plan.mutations.length,
		plan.organizationImpactAuthorizations.length,
	]);
	checksum.addNumbers(plan.cells.flatMap((cell) => [cell.x, cell.y]));
	checksum.addNumbers(plan.conflicts.flatMap((cell) => [cell.x, cell.y]));
	checksum.addNumbers(
		plan.mutations.flatMap((mutation) => [mutation.x, mutation.y, mutation.before, mutation.after]),
	);
	addAdvancedSwitchMutations(checksum, plan.switchMutations);
	addPortMutations(checksum, plan.portMutations);
	addEquipmentGroupMutations(checksum, plan.equipmentGroupMutations);
	addOrganizationMutations(checksum, plan.organizationMutations);
	checksum.addNumbers(plan.organizationImpactAuthorizations);
	if (plan.arrangement) {
		checksum.addNumbers([
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
	return Object.freeze({
		...plan,
		cells: Object.freeze(plan.cells.map((cell) => Object.freeze({ x: cell.x, y: cell.y }))),
		conflicts: Object.freeze(plan.conflicts.map((cell) => Object.freeze({ x: cell.x, y: cell.y }))),
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
		arrangement: plan.arrangement
			? Object.freeze({
					...plan.arrangement,
					translations: Object.freeze(
						plan.arrangement.translations.map((translation) =>
							Object.freeze({
								...translation,
								before: Object.freeze({ ...translation.before }),
								after: Object.freeze({ ...translation.after }),
							}),
						),
					),
					affectedOrganizationIds: Object.freeze([...plan.arrangement.affectedOrganizationIds]),
				})
			: null,
	});
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
	} else checksum.addStrings([record.template]);
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
	checksum.addNumbers([
		record.membership.railEdges.length,
		...record.membership.railEdges.flatMap((edge) => [
			edge.from.x,
			edge.from.y,
			edge.to.x,
			edge.to.y,
		]),
		record.membership.advancedSwitchIds.length,
		...record.membership.advancedSwitchIds,
		record.membership.equipmentGroupIds.length,
		...record.membership.equipmentGroupIds,
	]);
}
