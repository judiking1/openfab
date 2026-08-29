import { type AdvancedSwitchRecord, copyAdvancedSwitch } from "./AdvancedSwitch";
import type { PortEquipmentState } from "./EquipmentGroup";
import { OrderedTypedChecksum } from "./OrderedTypedChecksum";
import {
	staticFabAssemblyConnectorIntentError as connectorIntentError,
	STATIC_FAB_ASSEMBLY_CONNECTOR_PATCH_KIND,
	type StaticFabAssemblyConnectorIntent,
	type StaticFabAssemblyConnectorPlan,
} from "./StaticFabAssemblyConnector";
import {
	copyStaticFabOrganizationRecord,
	type StaticFabOrganizationRecord,
	type StaticFabOrganizationState,
	staticFabOrganizationParentIds,
	staticFabOrganizationProperties,
} from "./StaticFabOrganization";
import type { Cell, TileMap } from "./TileMap";

export interface StaticFabAssemblyConnectorWorkerTicket {
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

/** Opaque main-thread authority retained while one revision-bound Worker validates one intent. */
export interface StaticFabAssemblyConnectorPermit {
	readonly ticketId: number;
}

interface ConnectorSource {
	readonly map: TileMap;
	readonly portEquipment: PortEquipmentState;
	readonly organizations: StaticFabOrganizationState;
	readonly sourceChecksum: string;
}

interface ConnectorPermitSource extends ConnectorSource {
	readonly baseRevision: number;
	readonly basePatchSequence: number;
	readonly sourceNextAdvancedSwitchId: number;
	readonly sourceNextPortId: number;
	readonly sourceNextEquipmentGroupId: number;
	readonly sourceNextOrganizationId: number;
	readonly intentFingerprint: string;
}

const issuedPlans = new WeakMap<object, ConnectorSource>();
const certifiedPlans = new WeakMap<
	object,
	ConnectorSource & { readonly planFingerprint: string }
>();
const pendingPermits = new WeakMap<object, ConnectorPermitSource>();
let nextTicketId = 1;

export function staticFabAssemblyConnectorIntentError(value: unknown): string | null {
	return connectorIntentError(value);
}

export function staticFabAssemblyConnectorIntentFingerprint(
	intent: StaticFabAssemblyConnectorIntent,
): string {
	const error = staticFabAssemblyConnectorIntentError(intent);
	if (error) throw new TypeError(error);
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings([
		"STATIC_FAB_ASSEMBLY_CONNECTOR_INTENT",
		intent.purpose,
		intent.sourceGatewayId,
		intent.targetGatewayId,
		intent.side ?? "AUTO",
	]);
	checksum.addNumbers([
		intent.version,
		intent.sourceOrganizationId,
		intent.sourceAnchor.x,
		intent.sourceAnchor.y,
		intent.targetOrganizationId,
		intent.targetAnchor.x,
		intent.targetAnchor.y,
	]);
	return checksum.digest();
}

export function issueStaticFabAssemblyConnectorPermit(
	map: TileMap,
	portEquipment: PortEquipmentState,
	patchSequence: number,
	organizations: StaticFabOrganizationState,
	intent: StaticFabAssemblyConnectorIntent,
	sourceChecksum: string,
): StaticFabAssemblyConnectorPermit {
	if (!Number.isSafeInteger(patchSequence) || patchSequence < 0) {
		throw new RangeError("Assembly Connector patch sequence is invalid.");
	}
	if (typeof sourceChecksum !== "string" || sourceChecksum.length === 0) {
		throw new TypeError("Assembly Connector source checksum is missing.");
	}
	if (!Number.isSafeInteger(nextTicketId)) {
		throw new RangeError("Assembly Connector ticket sequence is exhausted.");
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
			intentFingerprint: staticFabAssemblyConnectorIntentFingerprint(intent),
		}),
	);
	return permit;
}

export function revokeStaticFabAssemblyConnectorPermit(
	permit: StaticFabAssemblyConnectorPermit,
): void {
	pendingPermits.delete(permit);
}

/** Adopt one exact structured-cloned Worker result; every permit is consumed even on failure. */
export function adoptStaticFabAssemblyConnectorWorkerPlan(
	permit: StaticFabAssemblyConnectorPermit,
	ticket: StaticFabAssemblyConnectorWorkerTicket,
	workerPlan: StaticFabAssemblyConnectorPlan,
	expectedProspectiveChecksum: string,
	map: TileMap,
	portEquipment: PortEquipmentState,
	patchSequence: number,
	organizations: StaticFabOrganizationState,
	intent: StaticFabAssemblyConnectorIntent,
): StaticFabAssemblyConnectorPlan {
	const source = pendingPermits.get(permit);
	pendingPermits.delete(permit);
	if (!source) throw new Error("Assembly Connector permit is missing or already consumed.");
	const intentFingerprint = staticFabAssemblyConnectorIntentFingerprint(intent);
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
		throw new Error("Assembly Connector permit no longer matches the live document.");
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
		ticket.prospectiveNextOrganizationId !== workerPlan.nextOrganizationIdAfter ||
		typeof expectedProspectiveChecksum !== "string" ||
		expectedProspectiveChecksum.length === 0 ||
		ticket.prospectiveChecksum !== expectedProspectiveChecksum
	) {
		throw new Error("Assembly Connector Worker ticket does not match its one-shot permit.");
	}
	if (
		!workerPlan.valid ||
		workerPlan.kind !== "build" ||
		workerPlan.baseRevision !== source.baseRevision ||
		workerPlan.basePatchSequence !== source.basePatchSequence ||
		workerPlan.nextOrganizationIdBefore !== source.sourceNextOrganizationId ||
		workerPlan.assemblyConnector.issueCode !== null ||
		workerPlan.assemblyConnector.sourceOrganizationId !== intent.sourceOrganizationId ||
		workerPlan.assemblyConnector.sourceGatewayId !== intent.sourceGatewayId ||
		workerPlan.assemblyConnector.targetOrganizationId !== intent.targetOrganizationId ||
		workerPlan.assemblyConnector.targetGatewayId !== intent.targetGatewayId ||
		workerPlan.assemblyConnector.purpose !== intent.purpose ||
		workerPlan.assemblyConnector.requestedSide !== intent.side ||
		(workerPlan.switchMutations?.length ?? 0) !== 0
	) {
		throw new Error("Assembly Connector Worker plan is stale or invalid.");
	}
	const planFingerprint = staticFabAssemblyConnectorPlanFingerprint(workerPlan);
	if (ticket.planFingerprint !== planFingerprint) {
		throw new Error("Assembly Connector Worker plan fingerprint diverged.");
	}
	const adopted = copyWorkerPlan(workerPlan);
	if (staticFabAssemblyConnectorPlanFingerprint(adopted) !== planFingerprint) {
		throw new Error("Assembly Connector plan changed during adoption.");
	}
	const issuedSource = Object.freeze({
		map,
		portEquipment,
		organizations,
		sourceChecksum: source.sourceChecksum,
	});
	issuedPlans.set(adopted, issuedSource);
	certifiedPlans.set(adopted, Object.freeze({ ...issuedSource, planFingerprint }));
	return adopted;
}

export function isIssuedStaticFabAssemblyConnectorPlan(
	plan: StaticFabAssemblyConnectorPlan,
): boolean {
	return issuedPlans.has(plan);
}

export function isStaticFabAssemblyConnectorPlanIssuedFor(
	plan: StaticFabAssemblyConnectorPlan,
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

export function consumeCertifiedStaticFabAssemblyConnectorPlanIssuedFor(
	plan: StaticFabAssemblyConnectorPlan,
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
		certification.planFingerprint !== staticFabAssemblyConnectorPlanFingerprint(plan)
	) {
		return false;
	}
	certifiedPlans.delete(plan);
	issuedPlans.delete(plan);
	return true;
}

export function staticFabAssemblyConnectorPlanFingerprint(
	plan: StaticFabAssemblyConnectorPlan,
): string {
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings([
		"STATIC_FAB_ASSEMBLY_CONNECTOR_PLAN",
		STATIC_FAB_ASSEMBLY_CONNECTOR_PATCH_KIND,
		plan.kind,
		plan.reason,
		plan.issueCode ?? "",
		plan.bend,
	]);
	checksum.addNumbers([
		plan.baseRevision,
		plan.basePatchSequence,
		plan.nextOrganizationIdBefore,
		plan.nextOrganizationIdAfter,
		plan.valid ? 1 : 0,
		plan.newEdges,
		plan.lengthMeters,
		plan.turns,
	]);
	addCells(checksum, plan.cells);
	addCells(checksum, plan.conflicts);
	checksum.addNumbers([
		plan.organizationImpactAuthorizations.length,
		...plan.organizationImpactAuthorizations,
	]);
	checksum.addNumbers([plan.mutations.length]);
	for (const mutation of plan.mutations) {
		checksum.addNumbers([mutation.x, mutation.y, mutation.before, mutation.after]);
	}
	const switchMutations = plan.switchMutations ?? [];
	checksum.addNumbers([switchMutations.length]);
	for (const mutation of switchMutations) {
		checksum.addNumbers([mutation.id]);
		addSwitchRecord(checksum, mutation.before);
		addSwitchRecord(checksum, mutation.after);
	}
	addOrganizationMutations(checksum, plan.organizationMutations);
	addNetworkLinkMetadata(checksum, plan.networkLink);
	const metadata = plan.assemblyConnector;
	checksum.addStrings([
		metadata.sourceGatewayId,
		metadata.targetGatewayId,
		metadata.requestedSide ?? "AUTO",
		metadata.hierarchyRole ?? "UNRESOLVED",
		metadata.purpose ?? "UNRESOLVED",
		metadata.issueCode ?? "",
	]);
	checksum.addNumbers([
		metadata.version,
		metadata.sourceOrganizationId,
		metadata.sourceAnchor.x,
		metadata.sourceAnchor.y,
		metadata.targetOrganizationId,
		metadata.targetAnchor.x,
		metadata.targetAnchor.y,
		metadata.bankOrganizationId ?? 0,
		metadata.fabOrganizationId ?? 0,
		metadata.createdBank ? 1 : 0,
		metadata.createdFab ? 1 : 0,
		metadata.outboundLengthMeters,
		metadata.returnLengthMeters,
	]);
	return checksum.digest();
}

function copyWorkerPlan(plan: StaticFabAssemblyConnectorPlan): StaticFabAssemblyConnectorPlan {
	const copyCell = (cell: Cell): Cell => Object.freeze({ x: cell.x, y: cell.y });
	const copyOptionalCell = (cell: Cell | null): Cell | null => (cell ? copyCell(cell) : null);
	return Object.freeze({
		...plan,
		cells: Object.freeze(plan.cells.map(copyCell)),
		conflicts: Object.freeze(plan.conflicts.map(copyCell)),
		mutations: Object.freeze(plan.mutations.map((mutation) => Object.freeze({ ...mutation }))),
		switchMutations: Object.freeze(
			(plan.switchMutations ?? []).map((mutation) =>
				Object.freeze({
					id: mutation.id,
					before: mutation.before ? copyAdvancedSwitch(mutation.before) : null,
					after: mutation.after ? copyAdvancedSwitch(mutation.after) : null,
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
		networkLink: Object.freeze({
			...plan.networkLink,
			sourceAnchor: copyCell(plan.networkLink.sourceAnchor),
			targetAnchor: copyCell(plan.networkLink.targetAnchor),
			sourceDeparture: copyOptionalCell(plan.networkLink.sourceDeparture),
			sourceArrival: copyOptionalCell(plan.networkLink.sourceArrival),
			targetArrival: copyOptionalCell(plan.networkLink.targetArrival),
			targetDeparture: copyOptionalCell(plan.networkLink.targetDeparture),
			outboundCells: Object.freeze(plan.networkLink.outboundCells.map(copyCell)),
			returnCells: Object.freeze(plan.networkLink.returnCells.map(copyCell)),
		}),
		assemblyConnector: Object.freeze({
			...plan.assemblyConnector,
			sourceAnchor: copyCell(plan.assemblyConnector.sourceAnchor),
			targetAnchor: copyCell(plan.assemblyConnector.targetAnchor),
		}),
	});
}

function addNetworkLinkMetadata(
	checksum: OrderedTypedChecksum,
	metadata: StaticFabAssemblyConnectorPlan["networkLink"],
): void {
	checksum.addStrings([metadata.placementCode, metadata.side ?? "AUTO"]);
	checksum.addNumbers([
		metadata.version,
		metadata.sourceAnchor.x,
		metadata.sourceAnchor.y,
		metadata.targetAnchor.x,
		metadata.targetAnchor.y,
		metadata.sourceForward ?? 0,
		metadata.targetForward ?? 0,
		metadata.junctionSpacingMeters,
		metadata.sourceComponentCellCount,
		metadata.targetComponentCellCount,
	]);
	for (const cell of [
		metadata.sourceDeparture,
		metadata.sourceArrival,
		metadata.targetArrival,
		metadata.targetDeparture,
	]) {
		checksum.addNumbers(cell ? [1, cell.x, cell.y] : [0]);
	}
	addCells(checksum, metadata.outboundCells);
	addCells(checksum, metadata.returnCells);
}

function addCells(checksum: OrderedTypedChecksum, cells: readonly Cell[]): void {
	checksum.addNumbers([cells.length, ...cells.flatMap((cell) => [cell.x, cell.y])]);
}

function addSwitchRecord(
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

function addOrganizationMutations(
	checksum: OrderedTypedChecksum,
	mutations: StaticFabAssemblyConnectorPlan["organizationMutations"],
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
