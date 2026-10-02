import type { AdvancedSwitchMutation } from "./AdvancedSwitch";
import { deriveAdvancedSwitchGeometry } from "./AdvancedSwitch";
import { stableSortSteps } from "./CooperativeSort";
import { type CooperativeTask, createCooperativeTask } from "./CooperativeTask";
import { isCanonicalPortEquipmentState } from "./EquipmentGroup";
import {
	type ValidatedPortEquipmentActivation,
	validatePortEquipmentActivation,
} from "./PortEquipmentActivation";
import type { RailMutation } from "./paint";
import { railMutationTopologyErrorSteps } from "./paint";
import { isSupportedRailCoordinate } from "./RailCoordinateDomain";
import {
	createRailModuleOwnershipIndexCompiler,
	type DirectedRailEdge,
	type RailModuleOwnershipIndex,
	railModuleOwnershipIndexMatchesMap,
} from "./RailModuleOwnership";
import {
	type RailPatchTransition,
	railPatchTransitionFingerprintCooperatively,
} from "./RailPatchHistory";
import { assertRailSourceCapacity } from "./RailSourceCapacity";
import { ALL_DIRECTIONS, moveCell } from "./railShape";
import type { StaticFabAssemblyRelationshipMutationV1 } from "./StaticFabAssemblyRelationship";
import {
	type ValidatedStaticFabAssemblyRelationshipActivation,
	validateStaticFabAssemblyRelationshipActivation,
} from "./StaticFabAssemblyRelationshipActivation";
import {
	applyStaticFabOrganizationMutationsSteps,
	compareDirectedRailEdges,
	createCanonicalStaticFabOrganizationStateBuilder,
	isCanonicalStaticFabOrganizationState,
	type StaticFabOrganizationRecord,
	type StaticFabOrganizationState,
	staticFabOrganizationEdgeKey,
	staticFabOrganizationParentIds,
	staticFabOrganizationProperties,
} from "./StaticFabOrganization";
import {
	consumeStaticFabOrganizationImpactIndex,
	type ValidatedStaticFabOrganizationActivation,
	validateStaticFabOrganizationActivation,
} from "./StaticFabOrganizationActivation";
import {
	cacheStaticFabOrganizationMembershipFingerprint,
	createStaticFabOrganizationMembershipFingerprintAccumulator,
} from "./StaticFabOrganizationFingerprint";
import type { StaticFabOrganizationImpactIndex } from "./StaticFabOrganizationImpactIndex";
import type { StaticFabProcessLoopRegistrationDocument } from "./StaticFabProcessLoopRegistration";
import {
	assertStaticFabProcessLoopRepairTransitionSteps,
	STATIC_FAB_PROCESS_LOOP_REPAIR_KIND,
} from "./StaticFabProcessLoopRepairContract";
import { cellKey, type TileMap } from "./TileMap";

export interface StaticFabProcessLoopRepairRequest {
	readonly document: StaticFabProcessLoopRegistrationDocument;
	readonly ownership: RailModuleOwnershipIndex;
	readonly organizationId: number;
	/** Caller-owned frozen data, stable under the exact current intent session around awaits. */
	readonly changes: readonly RailMutation[];
	readonly switchChanges?: readonly AdvancedSwitchMutation[];
	readonly sourceChecksum: string;
	readonly mirrorEpoch: number;
}

export interface StaticFabProcessLoopRepairPorts {
	readonly checkpoint: () => Promise<void>;
	/** Exact document/owner/intent session and current ready mirror checksum/epoch. */
	readonly isCurrent: () => boolean;
	readonly checksumTransition: (
		sourceChecksum: string,
		transition: RailPatchTransition,
		checkpoint: () => Promise<void>,
	) => Promise<string>;
}

export interface StaticFabProcessLoopRepairApply {
	readonly kind: typeof STATIC_FAB_PROCESS_LOOP_REPAIR_KIND;
	readonly organizationId: number;
	readonly name: string;
}

export interface StaticFabProcessLoopRepairPreparation {
	readonly request: StaticFabProcessLoopRepairRequest;
	readonly promise: Promise<StaticFabProcessLoopRepairApply>;
	cancel(): void;
}

/** Registry-owned plan, obtainable once only by the exact target document. Never a UI permit. */
export interface OwnedStaticFabProcessLoopRepairPlan extends RailPatchTransition {
	readonly kind: typeof STATIC_FAB_PROCESS_LOOP_REPAIR_KIND;
	readonly relationshipChanges: readonly StaticFabAssemblyRelationshipMutationV1[];
	readonly relationshipNextIdBefore: number;
	readonly relationshipNextIdAfter: number;
	readonly organizationImpactAuthorizations: readonly number[];
	readonly nextMap: TileMap;
	readonly nextOrganizations: StaticFabOrganizationState;
	readonly ownership: RailModuleOwnershipIndex;
	readonly portEquipmentActivation: ValidatedPortEquipmentActivation;
	readonly organizationActivation: ValidatedStaticFabOrganizationActivation;
	readonly relationshipActivation: ValidatedStaticFabAssemblyRelationshipActivation;
	readonly nextImpactIndex: StaticFabOrganizationImpactIndex;
	readonly sourceChecksum: string;
	readonly prospectiveChecksum: string;
	readonly assertCurrent: () => void;
	readonly assertSourceCurrent: () => void;
}

interface ApplyBinding {
	readonly request: StaticFabProcessLoopRepairRequest;
	readonly transition: RailPatchTransition;
	readonly plan: OwnedStaticFabProcessLoopRepairPlan;
	readonly fingerprint: string;
	readonly ports: StaticFabProcessLoopRepairPorts;
}

const pendingApplies = new WeakMap<object, ApplyBinding>();
const consumingApplies = new WeakMap<object, ApplyBinding>();
const revocations = new WeakMap<object, () => void>();

export function prepareStaticFabProcessLoopRepairCooperatively(
	input: StaticFabProcessLoopRepairRequest,
	ports: StaticFabProcessLoopRepairPorts,
): StaticFabProcessLoopRepairPreparation {
	const preparation = prepareRepairBindingCooperatively(input, ports, null);
	let issued: StaticFabProcessLoopRepairApply | null = null;
	const promise = preparation.promise.then((binding) => {
		binding.plan.assertCurrent();
		const owner = binding.plan.organizationChanges[0]?.before;
		if (!owner) throw new Error("Loop rail repair preparation lost its source owner.");
		issued = Object.freeze({
			kind: STATIC_FAB_PROCESS_LOOP_REPAIR_KIND,
			organizationId: owner.id,
			name: owner.name,
		});
		pendingApplies.set(issued, binding);
		revocations.set(issued, preparation.cancel);
		return issued;
	});
	return Object.freeze({
		request: preparation.request,
		promise,
		cancel(): void {
			preparation.cancel();
			if (issued) revokeStaticFabProcessLoopRepairApply(issued);
		},
	});
}

/**
 * Prepare an exact inverse/redo candidate without issuing any authored Apply. The document's
 * private top-history marker and the mirror's exact ledger independently authorize publication.
 */
export async function prepareStaticFabProcessLoopRepairHistoryCandidateCooperatively(
	input: StaticFabProcessLoopRepairRequest,
	transition: RailPatchTransition,
	ports: StaticFabProcessLoopRepairPorts,
): Promise<OwnedStaticFabProcessLoopRepairPlan> {
	return (await prepareRepairBindingCooperatively(input, ports, transition).promise).plan;
}

function prepareRepairBindingCooperatively(
	input: StaticFabProcessLoopRepairRequest,
	ports: StaticFabProcessLoopRepairPorts,
	historyTransition: RailPatchTransition | null,
): {
	readonly request: StaticFabProcessLoopRepairRequest;
	readonly promise: Promise<ApplyBinding>;
	readonly cancel: () => void;
} {
	if (!ports)
		throw new TypeError(
			"Loop rail repair requires explicit scheduling, source and checksum ports.",
		);
	const capturedPorts = Object.freeze({
		checkpoint: ports.checkpoint,
		isCurrent: ports.isCurrent,
		checksumTransition: ports.checksumTransition,
	});
	if (
		[capturedPorts.checkpoint, capturedPorts.isCurrent, capturedPorts.checksumTransition].some(
			(value) => typeof value !== "function",
		)
	)
		throw new TypeError(
			"Loop rail repair requires explicit scheduling, source and checksum ports.",
		);
	const captured = Object.freeze({
		document: input.document,
		ownership: input.ownership,
		organizationId: input.organizationId,
		changes: input.changes,
		sourceChecksum: input.sourceChecksum,
		mirrorEpoch: input.mirrorEpoch,
		switchChanges: input.switchChanges,
	});
	if (
		!Array.isArray(captured.changes) ||
		!Object.isFrozen(captured.changes) ||
		captured.changes.length === 0 ||
		(captured.switchChanges !== undefined &&
			(!Array.isArray(captured.switchChanges) || captured.switchChanges.length !== 0)) ||
		!positiveInt32(captured.organizationId)
	)
		throw new Error("Loop rail repair requires one owner and immutable rail-only changes.");
	if (
		!/^00000003(?::[0-9a-f]{8}){11}$/.test(captured.sourceChecksum) ||
		!Number.isSafeInteger(captured.mirrorEpoch) ||
		captured.mirrorEpoch < 0
	)
		throw new Error("Loop rail repair requires a current authored checksum and mirror epoch.");
	ports = capturedPorts;
	const request = Object.freeze({ ...captured, switchChanges: Object.freeze([]) });
	const document = request.document;
	const map = document.map,
		equipment = document.portEquipment,
		organizations = document.organizations;
	const relationships = document.relationships,
		operations = document.operationalConfiguration;
	const revision = map.getRevision(),
		generation = map.getMutationGeneration(),
		sequence = document.getPatchSequence();
	const cursors = [
		map.getAdvancedSwitchIdCursor(),
		equipment.nextPortId,
		equipment.nextEquipmentGroupId,
		organizations.nextOrganizationId,
		relationships.nextRelationshipId,
	];
	if (
		!isCanonicalPortEquipmentState(equipment) ||
		!isCanonicalStaticFabOrganizationState(organizations) ||
		!railModuleOwnershipIndexMatchesMap(request.ownership, map)
	)
		throw new Error(
			"Loop rail repair requires canonical state and the current source ownership index.",
		);
	const before = findOwner(organizations, request.organizationId);
	if (
		!before ||
		before.kind !== "AISLE" ||
		before.declaredSemanticRole !== "PROCESS_LOOP" ||
		staticFabOrganizationParentIds(before).length !== 0
	)
		throw new Error("Loop rail repair requires one existing parentless declared Process Loop.");
	let active = true;
	let candidate: TileMap | null = null;
	let candidateRevision = 0,
		candidateGeneration = 0;
	const assertSourceCurrent = (): void => {
		if (
			!active ||
			document.map !== map ||
			document.portEquipment !== equipment ||
			document.organizations !== organizations ||
			document.relationships !== relationships ||
			document.operationalConfiguration !== operations ||
			map.getRevision() !== revision ||
			map.getMutationGeneration() !== generation ||
			document.getPatchSequence() !== sequence ||
			map.getAdvancedSwitchIdCursor() !== cursors[0] ||
			equipment.nextPortId !== cursors[1] ||
			equipment.nextEquipmentGroupId !== cursors[2] ||
			organizations.nextOrganizationId !== cursors[3] ||
			relationships.nextRelationshipId !== cursors[4] ||
			!railModuleOwnershipIndexMatchesMap(request.ownership, map) ||
			(candidate !== null &&
				(candidate.getRevision() !== candidateRevision ||
					candidate.getMutationGeneration() !== candidateGeneration))
		) {
			active = false;
			throw new Error("Loop rail repair source, candidate or intent is no longer current.");
		}
	};
	const assertCurrent = (): void => {
		if (!ports.isCurrent()) active = false;
		assertSourceCurrent();
	};
	const checkpoint = async (): Promise<void> => {
		assertCurrent();
		await ports.checkpoint();
		assertCurrent();
	};
	assertCurrent();
	const promise = (async (): Promise<ApplyBinding> => {
		try {
			const changes = await finishSteps(copyRailChangesSteps(map, request.changes), checkpoint);
			const delta = await finishSteps(collectSignedEdgesSteps(changes), checkpoint);
			const after = await finishSteps(
				createRepairedOwnerSteps(map, before, delta, historyTransition === null),
				checkpoint,
			);
			const organizationChanges = Object.freeze([Object.freeze({ id: before.id, before, after })]);
			const transition: RailPatchTransition = Object.freeze({
				changes,
				switchChanges: Object.freeze([]),
				portChanges: Object.freeze([]),
				equipmentGroupChanges: Object.freeze([]),
				organizationChanges,
				organizationNextIdBefore: organizations.nextOrganizationId,
				organizationNextIdAfter: organizations.nextOrganizationId,
				relationshipChanges: Object.freeze([]),
				relationshipNextIdBefore: relationships.nextRelationshipId,
				relationshipNextIdAfter: relationships.nextRelationshipId,
				organizationImpactAuthorizations: Object.freeze([]),
				operationalConfigurationPatch: null,
			});
			await finishSteps(assertStaticFabProcessLoopRepairTransitionSteps(transition), checkpoint);
			await finishSteps(
				assertOtherOwnersUntouchedSteps(organizations, before.id, changes),
				checkpoint,
			);
			const topologyError = await finishSteps(
				railMutationTopologyErrorSteps(map, changes),
				checkpoint,
			);
			if (topologyError) throw new Error(topologyError);
			const nextOrganizations = await finishSteps(
				applyStaticFabOrganizationMutationsSteps(
					organizations,
					organizationChanges,
					organizations.nextOrganizationId,
				),
				checkpoint,
			);
			const nextMap = await finishSteps(map.createMutationCandidateSteps(changes, []), checkpoint);
			assertRailSourceCapacity(nextMap);
			candidate = nextMap;
			candidateRevision = nextMap.getRevision();
			candidateGeneration = nextMap.getMutationGeneration();
			const ownership = await finishTask(
				createRailModuleOwnershipIndexCompiler(nextMap),
				checkpoint,
			);
			const portEquipmentActivation = await validatePortEquipmentActivation(
				nextMap,
				equipment,
				checkpoint,
				128,
			);
			const organizationActivation = await validateStaticFabOrganizationActivation(
				nextMap,
				equipment,
				nextOrganizations,
				ownership,
				checkpoint,
				128,
			);
			const relationshipActivation = await validateStaticFabAssemblyRelationshipActivation(
				nextMap,
				equipment,
				nextOrganizations,
				relationships,
				ownership,
				organizationActivation,
				checkpoint,
				128,
			);
			const prospectiveChecksum = await ports.checksumTransition(
				request.sourceChecksum,
				transition,
				checkpoint,
			);
			if (
				!/^00000003(?::[0-9a-f]{8}){11}$/.test(prospectiveChecksum) ||
				prospectiveChecksum === request.sourceChecksum
			)
				throw new Error(
					"Loop rail repair prospective checksum must authenticate a changed authored state.",
				);
			const fingerprint = await railPatchTransitionFingerprintCooperatively(transition, checkpoint);
			if (
				historyTransition !== null &&
				fingerprint !==
					(await railPatchTransitionFingerprintCooperatively(historyTransition, checkpoint))
			)
				throw new Error("Loop rail repair candidate differs from its exact private history.");
			assertCurrent();
			const nextImpactIndex = consumeStaticFabOrganizationImpactIndex(
				organizationActivation,
				nextMap,
				equipment,
				nextOrganizations,
			);
			const plan: OwnedStaticFabProcessLoopRepairPlan = Object.freeze({
				...transition,
				relationshipChanges: Object.freeze([]),
				relationshipNextIdBefore: relationships.nextRelationshipId,
				relationshipNextIdAfter: relationships.nextRelationshipId,
				organizationImpactAuthorizations: Object.freeze([]),
				kind: STATIC_FAB_PROCESS_LOOP_REPAIR_KIND,
				nextMap,
				nextOrganizations,
				ownership,
				portEquipmentActivation,
				organizationActivation,
				relationshipActivation,
				nextImpactIndex,
				sourceChecksum: request.sourceChecksum,
				prospectiveChecksum,
				assertCurrent,
				assertSourceCurrent,
			});
			return Object.freeze({ request, transition, plan, fingerprint, ports });
		} catch (error) {
			active = false;
			throw error;
		}
	})();
	return Object.freeze({
		request,
		promise,
		cancel(): void {
			active = false;
		},
	});
}

export function revokeStaticFabProcessLoopRepairApply(
	apply: StaticFabProcessLoopRepairApply,
): void {
	revocations.get(apply)?.();
	revocations.delete(apply);
	pendingApplies.delete(apply);
	consumingApplies.delete(apply);
}

/** Reserve terminally before callbacks/awaits. Final publisher must still revoke after success/refusal. */
export async function consumeStaticFabProcessLoopRepairApplyCooperatively(
	apply: StaticFabProcessLoopRepairApply,
	document: StaticFabProcessLoopRegistrationDocument,
	checkpoint: () => Promise<void>,
): Promise<OwnedStaticFabProcessLoopRepairPlan | null> {
	const binding = pendingApplies.get(apply);
	pendingApplies.delete(apply);
	if (!binding) return null;
	if (binding.request.document !== document) {
		revokeStaticFabProcessLoopRepairApply(apply);
		return null;
	}
	consumingApplies.set(apply, binding);
	const check = async (): Promise<void> => {
		if (consumingApplies.get(apply) !== binding)
			throw new Error("Loop rail repair Apply was revoked.");
		binding.plan.assertCurrent();
		await checkpoint();
		if (consumingApplies.get(apply) !== binding)
			throw new Error("Loop rail repair Apply was revoked.");
		binding.plan.assertCurrent();
	};
	try {
		await check();
		const fingerprint = await railPatchTransitionFingerprintCooperatively(
			binding.transition,
			check,
		);
		if (fingerprint !== binding.fingerprint)
			throw new Error("Loop rail repair transition fingerprint changed.");
		const checksum = await binding.ports.checksumTransition(
			binding.request.sourceChecksum,
			binding.transition,
			check,
		);
		if (checksum !== binding.plan.prospectiveChecksum)
			throw new Error("Loop rail repair prospective checksum changed.");
		await check();
		return binding.plan;
	} catch (error) {
		revokeStaticFabProcessLoopRepairApply(apply);
		throw error;
	} finally {
		consumingApplies.delete(apply);
	}
}

function* copyRailChangesSteps(
	map: TileMap,
	input: readonly RailMutation[],
): Generator<void, readonly RailMutation[]> {
	const copied: RailMutation[] = [];
	const touched = new Set<string>();
	for (let index = 0; index < input.length; index++) {
		yield;
		if (!Object.hasOwn(Object.getOwnPropertyDescriptor(input, index) ?? {}, "value"))
			throw new Error("Loop rail repair intent requires immutable data entries.");
		const value = input[index];
		if (
			!value ||
			!Object.isFrozen(value) ||
			!["x", "y", "before", "after"].every((key) =>
				Object.hasOwn(Object.getOwnPropertyDescriptor(value, key) ?? {}, "value"),
			) ||
			!isSupportedRailCoordinate(value.x, value.y) ||
			!byte(value.before) ||
			!byte(value.after) ||
			value.before === value.after ||
			map.getEncoded(value.x, value.y) !== value.before
		)
			throw new Error("Loop rail repair intent contains invalid, mutable or stale cell changes.");
		const key = cellKey(value.x, value.y);
		if (touched.has(key) || map.getAdvancedSwitchOwningCell(value.x, value.y))
			throw new Error(
				"Loop rail repair cannot duplicate cells or change an existing switch claim.",
			);
		touched.add(key);
		copied.push(
			Object.freeze({ x: value.x, y: value.y, before: value.before, after: value.after }),
		);
	}
	return Object.freeze(copied);
}

interface SignedEdgeDelta {
	readonly added: ReadonlyMap<string, DirectedRailEdge>;
	readonly removed: ReadonlyMap<string, DirectedRailEdge>;
}

function* collectSignedEdgesSteps(
	changes: readonly RailMutation[],
): Generator<void, SignedEdgeDelta> {
	const added = new Map<string, DirectedRailEdge>(),
		removed = new Map<string, DirectedRailEdge>();
	for (const change of changes) {
		for (const direction of ALL_DIRECTIONS) {
			yield;
			for (const outgoing of [true, false]) {
				const bit = outgoing ? direction << 4 : direction;
				const adding = (change.after & ~change.before & bit) !== 0;
				const removing = (change.before & ~change.after & bit) !== 0;
				if (!adding && !removing) continue;
				const point = { x: change.x, y: change.y },
					neighbor = moveCell(point, direction);
				const edge = Object.freeze({
					from: Object.freeze(outgoing ? point : neighbor),
					to: Object.freeze(outgoing ? neighbor : point),
				});
				(adding ? added : removed).set(staticFabOrganizationEdgeKey(edge), edge);
			}
		}
	}
	return { added, removed };
}

function* createRepairedOwnerSteps(
	map: TileMap,
	before: StaticFabOrganizationRecord,
	delta: SignedEdgeDelta,
	requireAttachment: boolean,
): Generator<void, StaticFabOrganizationRecord> {
	const removed = new Set<string>();
	for (const key of delta.removed.keys()) {
		yield;
		removed.add(key);
	}
	const retained: DirectedRailEdge[] = [],
		added: DirectedRailEdge[] = [];
	const oldFootprint = new Set<string>();
	const beforeFingerprint = createStaticFabOrganizationMembershipFingerprintAccumulator();
	for (let index = 0; index < before.membership.railEdges.length; index++) {
		yield;
		const value = before.membership.railEdges[index] as DirectedRailEdge;
		beforeFingerprint.addRailEdge(index, value);
		oldFootprint.add(cellKey(value.from.x, value.from.y));
		oldFootprint.add(cellKey(value.to.x, value.to.y));
		if (!removed.delete(staticFabOrganizationEdgeKey(value))) retained.push(value);
	}
	if (removed.size !== 0)
		throw new Error("Loop rail repair cannot remove any rail edge outside the existing owner.");
	for (let index = 0; index < before.membership.advancedSwitchIds.length; index++) {
		yield;
		const id = before.membership.advancedSwitchIds[index] as number;
		beforeFingerprint.addAdvancedSwitchId(index, id);
		const record = map.getAdvancedSwitch(id);
		if (!record) throw new Error("Loop rail repair source switch membership is missing.");
		for (const cell of deriveAdvancedSwitchGeometry(record).claimedCells) {
			yield;
			oldFootprint.add(cellKey(cell.x, cell.y));
		}
	}
	for (const value of delta.added.values()) {
		yield;
		added.push(value);
	}
	if (requireAttachment) yield* assertNewComponentsAttachedSteps(added, oldFootprint);
	yield* stableSortSteps(added, compareDirectedRailEdges);
	const builder = createCanonicalStaticFabOrganizationStateBuilder(before.id + 1);
	let sourceIndex = 0,
		addedIndex = 0;
	while (sourceIndex < retained.length || addedIndex < added.length) {
		yield;
		const source = retained[sourceIndex],
			target = added[addedIndex];
		const order = source && target ? compareDirectedRailEdges(source, target) : source ? -1 : 1;
		if (order === 0) throw new Error("Loop rail repair cannot acquire unchanged existing rail.");
		if (order < 0) {
			builder.addRailEdge(source as DirectedRailEdge);
			sourceIndex++;
		} else {
			builder.addRailEdge(target as DirectedRailEdge);
			addedIndex++;
		}
	}
	for (const id of before.membership.advancedSwitchIds) {
		yield;
		builder.addAdvancedSwitchId(id);
	}
	for (let index = 0; index < before.membership.equipmentGroupIds.length; index++) {
		yield;
		const id = before.membership.equipmentGroupIds[index] as number;
		beforeFingerprint.addEquipmentGroupId(index, id);
		builder.addEquipmentGroupId(id);
	}
	// Prime the exact canonical before membership during existing bounded walks, before any
	// legacy checksum/fingerprint adapter can otherwise hide its first cold whole-record hash.
	cacheStaticFabOrganizationMembershipFingerprint(before.membership, beforeFingerprint.finish());
	const properties = staticFabOrganizationProperties(before);
	builder.finishRecord({
		id: before.id,
		kind: "AISLE",
		name: before.name,
		declaredSemanticRole: "PROCESS_LOOP",
		description: properties.description,
		color: properties.color,
	});
	return builder.finish().records[0] as StaticFabOrganizationRecord;
}

function* assertNewComponentsAttachedSteps(
	added: readonly DirectedRailEdge[],
	oldFootprint: ReadonlySet<string>,
): Generator<void> {
	const neighbors = new Map<string, string[]>();
	for (const edge of added) {
		yield;
		const left = cellKey(edge.from.x, edge.from.y),
			right = cellKey(edge.to.x, edge.to.y);
		const outgoing = neighbors.get(left) ?? [],
			incoming = neighbors.get(right) ?? [];
		outgoing.push(right);
		incoming.push(left);
		neighbors.set(left, outgoing);
		neighbors.set(right, incoming);
	}
	const visited = new Set<string>();
	for (const start of neighbors.keys()) {
		yield;
		if (visited.has(start)) continue;
		const queue = [start];
		visited.add(start);
		let touchesOld = false;
		for (let index = 0; index < queue.length; index++) {
			yield;
			const key = queue[index] as string;
			touchesOld ||= oldFootprint.has(key);
			for (const neighbor of neighbors.get(key) ?? []) {
				yield;
				if (visited.has(neighbor)) continue;
				visited.add(neighbor);
				queue.push(neighbor);
			}
		}
		if (!touchesOld) throw new Error("New repair rail must touch the existing Loop footprint.");
	}
}

function* assertOtherOwnersUntouchedSteps(
	state: StaticFabOrganizationState,
	targetId: number,
	changes: readonly RailMutation[],
): Generator<void> {
	const touched = new Set<string>();
	for (const change of changes) {
		yield;
		touched.add(cellKey(change.x, change.y));
	}
	for (const owner of state.records) {
		yield;
		if (owner.id === targetId) continue;
		for (const edge of owner.membership.railEdges) {
			yield;
			if (
				touched.has(cellKey(edge.from.x, edge.from.y)) ||
				touched.has(cellKey(edge.to.x, edge.to.y))
			)
				throw new Error(`Loop rail repair would touch protected organization ${owner.id}.`);
		}
	}
}

/** Source checks for decoded Worker transitions; this validator grants no publication authority. */
export function* assertStaticFabProcessLoopRepairSourceSteps(
	map: TileMap,
	organizations: StaticFabOrganizationState,
	transition: RailPatchTransition,
	mode: "authored" | "exact-history",
): Generator<void> {
	if (mode !== "authored" && mode !== "exact-history")
		throw new Error("Invalid Loop repair validation mode.");
	const { organizationId } = yield* assertStaticFabProcessLoopRepairTransitionSteps(transition);
	const owner = findOwner(organizations, organizationId);
	if (!owner) throw new Error("Loop rail repair source owner is missing.");
	for (const change of transition.changes) {
		yield;
		if (
			map.getEncoded(change.x, change.y) !== change.before ||
			map.getAdvancedSwitchOwningCell(change.x, change.y)
		)
			throw new Error("Loop rail repair has stale cells or changes an existing switch claim.");
	}
	yield* assertOtherOwnersUntouchedSteps(organizations, organizationId, transition.changes);
	if (mode === "authored") {
		const footprint = new Set<string>();
		for (const edge of owner.membership.railEdges) {
			yield;
			footprint.add(cellKey(edge.from.x, edge.from.y));
			footprint.add(cellKey(edge.to.x, edge.to.y));
		}
		for (const id of owner.membership.advancedSwitchIds) {
			yield;
			const record = map.getAdvancedSwitch(id);
			if (!record) throw new Error("Loop rail repair source switch is missing.");
			for (const cell of deriveAdvancedSwitchGeometry(record).claimedCells) {
				yield;
				footprint.add(cellKey(cell.x, cell.y));
			}
		}
		const delta = yield* collectSignedEdgesSteps(transition.changes);
		const added: DirectedRailEdge[] = [];
		for (const edge of delta.added.values()) {
			yield;
			added.push(edge);
		}
		yield* assertNewComponentsAttachedSteps(added, footprint);
	}
	const topologyError = yield* railMutationTopologyErrorSteps(map, transition.changes);
	if (topologyError) throw new Error(topologyError);
}

function findOwner(
	state: StaticFabOrganizationState,
	id: number,
): StaticFabOrganizationRecord | null {
	let low = 0,
		high = state.records.length - 1;
	while (low <= high) {
		const middle = Math.floor((low + high) / 2),
			record = state.records[middle] as StaticFabOrganizationRecord;
		if (record.id === id) return record;
		if (record.id < id) low = middle + 1;
		else high = middle - 1;
	}
	return null;
}

async function finishSteps<T>(
	steps: Generator<void, T>,
	checkpoint: () => Promise<void>,
): Promise<T> {
	return finishTask(createCooperativeTask(steps), checkpoint);
}
async function finishTask<T>(
	task: CooperativeTask<T>,
	checkpoint: () => Promise<void>,
): Promise<T> {
	while (!task.done) {
		task.step(128);
		await checkpoint();
	}
	return task.finish();
}
function positiveInt32(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 0x7fff_ffff;
}
function byte(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 0xff;
}
