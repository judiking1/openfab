import { type AdvancedSwitchRecord, copyAdvancedSwitch } from "./AdvancedSwitch";
import { completeCooperativeSteps, createCooperativeTask } from "./CooperativeTask";
import type { PortEquipmentState } from "./EquipmentGroup";
import { freezeTransferDataContainersSteps } from "./ImmutableDataContainers";
import { OrderedTypedChecksum } from "./OrderedTypedChecksum";
import {
	staticFabAssemblyConnectorIntentError as connectorIntentError,
	STATIC_FAB_ASSEMBLY_CONNECTOR_PATCH_KIND,
	type StaticFabAssemblyConnectorIntent,
	type StaticFabAssemblyConnectorPlan,
} from "./StaticFabAssemblyConnector";
import {
	copyStaticFabAssemblyConnectorRelationshipProductionSteps,
	staticFabAssemblyConnectorRelationshipProductionShapeErrorSteps,
} from "./StaticFabAssemblyConnectorRelationshipProduction";
import {
	checksumStaticFabAssemblyRelationshipRecordSteps,
	type StaticFabAssemblyRelationshipStateV1,
} from "./StaticFabAssemblyRelationship";
import {
	copyStaticFabOrganizationRecordSteps,
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

/** Opaque main-thread authority retained while one revision-bound Worker validates one intent. */
export interface StaticFabAssemblyConnectorPermit {
	readonly ticketId: number;
}

interface ConnectorSource {
	readonly map: TileMap;
	readonly portEquipment: PortEquipmentState;
	readonly organizations: StaticFabOrganizationState;
	readonly sourceChecksum: string;
	readonly sourceMapMutationGeneration: number;
	readonly relationships: StaticFabAssemblyRelationshipStateV1;
}

interface ConnectorPermitSource extends ConnectorSource {
	readonly baseRevision: number;
	readonly basePatchSequence: number;
	readonly sourceNextAdvancedSwitchId: number;
	readonly sourceNextPortId: number;
	readonly sourceNextEquipmentGroupId: number;
	readonly sourceNextOrganizationId: number;
	readonly sourceNextRelationshipId: number;
	readonly intentFingerprint: string;
}

const issuedPlans = new WeakMap<object, ConnectorSource>();
const certifiedPlans = new WeakMap<
	object,
	ConnectorSource & { readonly planFingerprint: string }
>();
const pendingPermits = new WeakMap<object, ConnectorPermitSource>();
const adoptingPermits = new WeakMap<object, ConnectorPermitSource>();
const ownedPlanFingerprints = new WeakMap<object, string>();
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
	relationships: StaticFabAssemblyRelationshipStateV1,
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
			intentFingerprint: staticFabAssemblyConnectorIntentFingerprint(intent),
		}),
	);
	return permit;
}

export function revokeStaticFabAssemblyConnectorPermit(
	permit: StaticFabAssemblyConnectorPermit,
): void {
	pendingPermits.delete(permit);
	adoptingPermits.delete(permit);
}

/** Synchronous compatibility path; browser admission uses the cooperative variant. */
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
	relationships: StaticFabAssemblyRelationshipStateV1,
): StaticFabAssemblyConnectorPlan {
	const source = takeConnectorPermit(permit);
	const prepared = completeCooperativeSteps(
		prepareConnectorAdoptionSteps(
			source,
			permit,
			ticket,
			workerPlan,
			expectedProspectiveChecksum,
			map,
			portEquipment,
			patchSequence,
			organizations,
			intent,
			relationships,
		),
	);
	assertConnectorSourceCurrent(source, map, portEquipment, organizations, relationships);
	return certifyConnectorAdoption(prepared);
}

export async function adoptStaticFabAssemblyConnectorWorkerPlanCooperatively(
	permit: StaticFabAssemblyConnectorPermit,
	ticket: StaticFabAssemblyConnectorWorkerTicket,
	workerPlan: StaticFabAssemblyConnectorPlan,
	expectedProspectiveChecksum: string,
	map: TileMap,
	portEquipment: PortEquipmentState,
	patchSequence: number,
	organizations: StaticFabOrganizationState,
	intent: StaticFabAssemblyConnectorIntent,
	relationships: StaticFabAssemblyRelationshipStateV1,
	checkpoint: () => Promise<void>,
	operationBudget = 128,
): Promise<StaticFabAssemblyConnectorPlan> {
	const source = takeConnectorPermit(permit);
	if (!Number.isSafeInteger(operationBudget) || operationBudget <= 0)
		throw new RangeError("Connector adoption operation budget must be positive.");
	ticket = Object.freeze({ ...ticket });
	adoptingPermits.set(permit, source);
	const check = () => {
		if (adoptingPermits.get(permit) !== source)
			throw new Error("Connector adoption was cancelled.");
		assertConnectorSourceCurrent(source, map, portEquipment, organizations, relationships);
	};
	try {
		const task = createCooperativeTask(
			prepareConnectorAdoptionSteps(
				source,
				permit,
				ticket,
				workerPlan,
				expectedProspectiveChecksum,
				map,
				portEquipment,
				patchSequence,
				organizations,
				intent,
				relationships,
			),
		);
		while (!task.done) {
			check();
			task.step(operationBudget);
			await checkpoint();
			check();
		}
		return certifyConnectorAdoption(task.finish());
	} finally {
		adoptingPermits.delete(permit);
	}
}

interface PreparedConnectorAdoption {
	readonly plan: StaticFabAssemblyConnectorPlan;
	readonly source: ConnectorPermitSource;
	readonly planFingerprint: string;
}

function takeConnectorPermit(permit: StaticFabAssemblyConnectorPermit): ConnectorPermitSource {
	const source = pendingPermits.get(permit);
	pendingPermits.delete(permit);
	if (!source) throw new Error("Assembly Connector permit is missing or already consumed.");
	return source;
}

function assertConnectorSourceCurrent(
	source: ConnectorPermitSource,
	map: TileMap,
	ports: PortEquipmentState,
	organizations: StaticFabOrganizationState,
	relationships: StaticFabAssemblyRelationshipStateV1,
): void {
	if (
		source.map !== map ||
		source.portEquipment !== ports ||
		source.organizations !== organizations ||
		source.relationships !== relationships ||
		source.sourceMapMutationGeneration !== map.getMutationGeneration() ||
		source.baseRevision !== map.getRevision() ||
		source.sourceNextAdvancedSwitchId !== map.getAdvancedSwitchIdCursor() ||
		source.sourceNextPortId !== ports.nextPortId ||
		source.sourceNextEquipmentGroupId !== ports.nextEquipmentGroupId ||
		source.sourceNextOrganizationId !== organizations.nextOrganizationId ||
		source.sourceNextRelationshipId !== relationships.nextRelationshipId
	)
		throw new Error("Assembly Connector source changed during adoption.");
}

function certifyConnectorAdoption(
	prepared: PreparedConnectorAdoption,
): StaticFabAssemblyConnectorPlan {
	const { plan, source, planFingerprint } = prepared;
	issuedPlans.set(plan, source);
	certifiedPlans.set(plan, Object.freeze({ ...source, planFingerprint }));
	ownedPlanFingerprints.set(plan, planFingerprint);
	return plan;
}

function* prepareConnectorAdoptionSteps(
	source: ConnectorPermitSource,
	permit: StaticFabAssemblyConnectorPermit,
	ticket: StaticFabAssemblyConnectorWorkerTicket,
	workerPlan: StaticFabAssemblyConnectorPlan,
	expectedProspectiveChecksum: string,
	map: TileMap,
	portEquipment: PortEquipmentState,
	patchSequence: number,
	organizations: StaticFabOrganizationState,
	intent: StaticFabAssemblyConnectorIntent,
	relationships: StaticFabAssemblyRelationshipStateV1,
): Generator<void, PreparedConnectorAdoption> {
	const intentFingerprint = staticFabAssemblyConnectorIntentFingerprint(intent);
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
		throw new Error("Assembly Connector permit no longer matches the live document.");
	}
	const production = workerPlan.relationshipProduction;
	const productionError =
		yield* staticFabAssemblyConnectorRelationshipProductionShapeErrorSteps(production);
	if (productionError || !production) throw new Error(productionError ?? "Missing relationship");
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
		production.nextRelationshipIdBefore !== source.sourceNextRelationshipId ||
		ticket.intentFingerprint !== intentFingerprint ||
		ticket.prospectiveNextAdvancedSwitchId !== source.sourceNextAdvancedSwitchId ||
		ticket.prospectiveNextPortId !== source.sourceNextPortId ||
		ticket.prospectiveNextEquipmentGroupId !== source.sourceNextEquipmentGroupId ||
		ticket.prospectiveNextOrganizationId !== workerPlan.nextOrganizationIdAfter ||
		ticket.prospectiveNextRelationshipId !== production.nextRelationshipIdAfter ||
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
	const adopted = yield* copyStaticFabAssemblyConnectorWorkerPlanSteps(workerPlan);
	const planFingerprint = yield* staticFabAssemblyConnectorPlanFingerprintSteps(adopted);
	if (ticket.planFingerprint !== planFingerprint)
		throw new Error("Assembly Connector Worker plan fingerprint diverged.");
	return { plan: adopted, source, planFingerprint };
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
	relationships: StaticFabAssemblyRelationshipStateV1,
): boolean {
	const source = issuedPlans.get(plan);
	return (
		source?.map === map &&
		source.portEquipment === portEquipment &&
		source.organizations === organizations &&
		source.relationships === relationships &&
		source.sourceMapMutationGeneration === map.getMutationGeneration() &&
		plan.relationshipProduction?.nextRelationshipIdBefore === relationships.nextRelationshipId
	);
}

export function consumeCertifiedStaticFabAssemblyConnectorPlanIssuedFor(
	plan: StaticFabAssemblyConnectorPlan,
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
		plan.relationshipProduction?.nextRelationshipIdBefore !== relationships.nextRelationshipId ||
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

export function staticFabAssemblyConnectorPlanFingerprint(
	plan: StaticFabAssemblyConnectorPlan,
): string {
	return completeCooperativeSteps(staticFabAssemblyConnectorPlanFingerprintSteps(plan));
}

export function* staticFabAssemblyConnectorPlanFingerprintSteps(
	plan: StaticFabAssemblyConnectorPlan,
): Generator<void, string> {
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
	yield* addCells(checksum, plan.cells);
	yield* addCells(checksum, plan.conflicts);
	yield* checksum.addNumberSequenceSteps(
		plan.organizationImpactAuthorizations.length + 1,
		(index) =>
			index === 0
				? plan.organizationImpactAuthorizations.length
				: (plan.organizationImpactAuthorizations[index - 1] as number),
	);
	checksum.addNumbers([plan.mutations.length]);
	for (const mutation of plan.mutations) {
		yield;
		checksum.addNumbers([mutation.x, mutation.y, mutation.before, mutation.after]);
	}
	const switchMutations = plan.switchMutations ?? [];
	checksum.addNumbers([switchMutations.length]);
	for (const mutation of switchMutations) {
		yield;
		checksum.addNumbers([mutation.id]);
		addSwitchRecord(checksum, mutation.before);
		addSwitchRecord(checksum, mutation.after);
	}
	yield* addOrganizationMutations(checksum, plan.organizationMutations);
	const production = plan.relationshipProduction;
	checksum.addNumbers([production ? 1 : 0]);
	if (production) {
		const error =
			yield* staticFabAssemblyConnectorRelationshipProductionShapeErrorSteps(production);
		if (error) throw new Error(error);
		checksum.addNumbers([production.nextRelationshipIdBefore, production.nextRelationshipIdAfter]);
		for (const change of production.mutations) {
			if (!change.after) throw new Error("Connector production record is missing.");
			checksum.addNumbers([change.id]);
			checksum.addStrings([yield* checksumStaticFabAssemblyRelationshipRecordSteps(change.after)]);
		}
	}
	yield* addNetworkLinkMetadata(checksum, plan.networkLink);
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

/** Own all received containers before granting one-shot authority. */
export function* copyStaticFabAssemblyConnectorWorkerPlanSteps(
	plan: StaticFabAssemblyConnectorPlan,
): Generator<void, StaticFabAssemblyConnectorPlan> {
	yield* freezeTransferDataContainersSteps(plan);
	const copyCell = (cell: Cell): Cell => Object.freeze({ x: cell.x, y: cell.y });
	const optionalCell = (cell: Cell | null): Cell | null => (cell ? copyCell(cell) : null);
	const mutations = [],
		switches = [],
		organizations = [],
		authorizations = [];
	for (const mutation of plan.mutations) {
		yield;
		mutations.push(Object.freeze({ ...mutation }));
	}
	for (const mutation of plan.switchMutations ?? []) {
		yield;
		switches.push(
			Object.freeze({
				id: mutation.id,
				before: mutation.before ? copyAdvancedSwitch(mutation.before) : null,
				after: mutation.after ? copyAdvancedSwitch(mutation.after) : null,
			}),
		);
	}
	for (const mutation of plan.organizationMutations) {
		yield;
		organizations.push(
			Object.freeze({
				id: mutation.id,
				before: mutation.before
					? yield* copyStaticFabOrganizationRecordSteps(mutation.before)
					: null,
				after: mutation.after ? yield* copyStaticFabOrganizationRecordSteps(mutation.after) : null,
			}),
		);
	}
	for (const id of plan.organizationImpactAuthorizations) {
		yield;
		authorizations.push(id);
	}
	return Object.freeze({
		...plan,
		relationshipProduction: plan.relationshipProduction
			? yield* copyStaticFabAssemblyConnectorRelationshipProductionSteps(
					plan.relationshipProduction,
				)
			: null,
		cells: yield* copyCellsSteps(plan.cells),
		conflicts: yield* copyCellsSteps(plan.conflicts),
		mutations: Object.freeze(mutations),
		switchMutations: Object.freeze(switches),
		organizationMutations: Object.freeze(organizations),
		organizationImpactAuthorizations: Object.freeze(authorizations),
		networkLink: Object.freeze({
			...plan.networkLink,
			sourceAnchor: copyCell(plan.networkLink.sourceAnchor),
			targetAnchor: copyCell(plan.networkLink.targetAnchor),
			sourceDeparture: optionalCell(plan.networkLink.sourceDeparture),
			sourceArrival: optionalCell(plan.networkLink.sourceArrival),
			targetArrival: optionalCell(plan.networkLink.targetArrival),
			targetDeparture: optionalCell(plan.networkLink.targetDeparture),
			outboundCells: yield* copyCellsSteps(plan.networkLink.outboundCells),
			returnCells: yield* copyCellsSteps(plan.networkLink.returnCells),
		}),
		assemblyConnector: Object.freeze({
			...plan.assemblyConnector,
			sourceAnchor: copyCell(plan.assemblyConnector.sourceAnchor),
			targetAnchor: copyCell(plan.assemblyConnector.targetAnchor),
		}),
	});
}

function* copyCellsSteps(source: readonly Cell[]): Generator<void, readonly Cell[]> {
	const cells = [];
	for (const cell of source) {
		yield;
		cells.push(Object.freeze({ x: cell.x, y: cell.y }));
	}
	return Object.freeze(cells);
}

function* addNetworkLinkMetadata(
	checksum: OrderedTypedChecksum,
	metadata: StaticFabAssemblyConnectorPlan["networkLink"],
): Generator<void> {
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
	yield* addCells(checksum, metadata.outboundCells);
	yield* addCells(checksum, metadata.returnCells);
}

function* addCells(checksum: OrderedTypedChecksum, cells: readonly Cell[]): Generator<void> {
	yield* checksum.addNumberSequenceSteps(1 + cells.length * 2, (index) =>
		index === 0
			? cells.length
			: index % 2 === 1
				? (cells[(index - 1) >> 1] as Cell).x
				: (cells[(index - 1) >> 1] as Cell).y,
	);
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

function* addOrganizationMutations(
	checksum: OrderedTypedChecksum,
	mutations: StaticFabAssemblyConnectorPlan["organizationMutations"],
): Generator<void> {
	checksum.addNumbers([mutations.length]);
	for (const mutation of mutations) {
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
	const parents = staticFabOrganizationParentIds(record);
	const properties = staticFabOrganizationProperties(record);
	yield* checksum.addNumberSequenceSteps(3 + parents.length, (index) =>
		index === 0
			? 1
			: index === 1
				? record.id
				: index === 2
					? parents.length
					: (parents[index - 3] as number),
	);
	checksum.addStrings([record.kind, record.name, properties.description, properties.color]);
	const edges = record.membership.railEdges,
		switches = record.membership.advancedSwitchIds,
		groups = record.membership.equipmentGroupIds;
	const switchOffset = 1 + edges.length * 4;
	const groupOffset = switchOffset + 1 + switches.length;
	yield* checksum.addNumberSequenceSteps(groupOffset + 1 + groups.length, (index) => {
		if (index === 0) return edges.length;
		if (index < switchOffset) {
			const edge = edges[
				(index - 1) >> 2
			] as StaticFabOrganizationRecord["membership"]["railEdges"][number];
			switch ((index - 1) % 4) {
				case 0:
					return edge.from.x;
				case 1:
					return edge.from.y;
				case 2:
					return edge.to.x;
				default:
					return edge.to.y;
			}
		}
		if (index === switchOffset) return switches.length;
		if (index < groupOffset) return switches[index - switchOffset - 1] as number;
		return index === groupOffset ? groups.length : (groups[index - groupOffset - 1] as number);
	});
}
