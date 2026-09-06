import {
	ADVANCED_SWITCH_MAX_ID,
	type AdvancedSwitchMutation,
	type AdvancedSwitchRecord,
	copyAdvancedSwitch,
	deriveAdvancedSwitchGeometry,
} from "./AdvancedSwitch";
import { completeCooperativeSteps, createCooperativeTask } from "./CooperativeTask";
import {
	applyPortEquipmentMutations,
	copyEquipmentGroupRecord,
	type EquipmentGroupMutation,
	type EquipmentGroupRecord,
	type PortEquipmentState,
} from "./EquipmentGroup";
import {
	canonicalEquipmentGroupPortIds,
	equipmentGroupPortBarcode,
} from "./EquipmentGroupPortOrder";
import { OrderedTypedChecksum } from "./OrderedTypedChecksum";
import { allocatePortEquipmentRecordIds } from "./PortEquipmentIdAllocator";
import { portEquipmentLayoutError } from "./PortEquipmentLayoutValidator";
import { copyPortRecord, type PortMutation, type PortRecord } from "./PortRecord";
import { type RailConstructionPlan, type RailMutation, railMutationTopologyError } from "./paint";
import { directionBetween, oppositeDirection } from "./railShape";
import {
	applyStaticFabAssemblyRelationshipMutations,
	checksumStaticFabAssemblyRelationshipRecord,
	checksumStaticFabAssemblyRelationshipRecordSteps,
	copyStaticFabAssemblyRelationshipRecord,
	remapStaticFabAssemblyRelationshipRecord,
	type StaticFabAssemblyRelationshipMutationV1,
	type StaticFabAssemblyRelationshipStateV1,
	staticFabAssemblyRelationshipStateSourceError,
} from "./StaticFabAssemblyRelationship";
import {
	applyStaticFabOrganizationMutations,
	compareDirectedRailEdges,
	copyStaticFabOrganizationRecord,
	normalizeStaticFabOrganizationName,
	type StaticFabOrganizationKind,
	type StaticFabOrganizationMutation,
	type StaticFabOrganizationRecord,
	type StaticFabOrganizationState,
	staticFabOrganizationStateError,
} from "./StaticFabOrganization";
import {
	type MaterializedStaticFabOrganizationBundle,
	materializeStaticFabOrganizationBundle,
	prepareStaticFabOrganizationBundle,
	type StaticFabOrganizationBundle,
	type StaticFabOrganizationBundleEquipmentGroup,
	type StaticFabOrganizationBundleQuarterTurns,
	validateFrozenStaticFabOrganizationBundle,
} from "./StaticFabOrganizationBundle";
import { type Cell, cellKey, decodeRailCell, encodeRailCell, type TileMap } from "./TileMap";

export const STATIC_FAB_ORGANIZATION_BUNDLE_PLACEMENT_KIND =
	"place-static-fab-organization-bundle" as const;

export interface StaticFabOrganizationBundlePlacementMetadata {
	readonly collisionPolicy: "EMPTY_FOOTPRINT_V1";
	readonly anchor: Cell;
	readonly quarterTurns: StaticFabOrganizationBundleQuarterTurns;
	readonly sourceModuleCount: number;
	readonly railEdgeCount: number;
	readonly advancedSwitchCount: number;
	readonly portCount: number;
	readonly equipmentGroupCount: number;
	readonly organizationCount: number;
	readonly relationshipCount: number;
	readonly widthMeters: number;
	readonly heightMeters: number;
	readonly organizationNames: readonly string[];
}

export interface StaticFabOrganizationBundlePlacementProof {
	readonly sourceRevision: number;
	readonly sourcePatchSequence: number;
	readonly sourceChecksum: string;
	readonly planFingerprint: string;
	readonly validationLevel: "exact";
}

/** Serializable one-shot evidence issued by the exact placement Worker. */
export interface StaticFabOrganizationBundlePlacementWorkerTicket
	extends StaticFabOrganizationBundlePlacementProof {
	readonly ticketId: number;
	readonly sourceNextAdvancedSwitchId: number;
	readonly sourceNextPortId: number;
	readonly sourceNextEquipmentGroupId: number;
	readonly sourceNextOrganizationId: number;
	readonly sourceNextRelationshipId: number;
	readonly bundleFingerprint: string;
	readonly anchor: Cell;
	readonly quarterTurns: StaticFabOrganizationBundleQuarterTurns;
	readonly prospectiveChecksum: string;
	readonly prospectiveNextAdvancedSwitchId: number;
	readonly prospectiveNextPortId: number;
	readonly prospectiveNextEquipmentGroupId: number;
	readonly prospectiveNextOrganizationId: number;
	readonly prospectiveNextRelationshipId: number;
}

/**
 * Opaque main-thread authority for one Worker request. Structural clones are intentionally useless:
 * adoption requires the exact object identity retained in the private permit registry.
 */
export interface StaticFabOrganizationBundlePlacementPermit {
	readonly ticketId: number;
}

/** One issued, revision-bound proposal for every authored domain in an organization bundle. */
export type StaticFabOrganizationBundlePlacementPlan = RailConstructionPlan & {
	readonly basePatchSequence: number;
	readonly nextOrganizationIdBefore: number;
	readonly nextRelationshipIdBefore: number;
	readonly nextOrganizationIdAfter: number;
	readonly switchMutations: readonly AdvancedSwitchMutation[];
	readonly portMutations: readonly PortMutation[];
	readonly equipmentGroupMutations: readonly EquipmentGroupMutation[];
	readonly organizationMutations: readonly StaticFabOrganizationMutation[];
	readonly relationshipMutations: readonly StaticFabAssemblyRelationshipMutationV1[];
	readonly nextRelationshipIdAfter: number;
	readonly organizationBundle: StaticFabOrganizationBundlePlacementMetadata;
};

export interface StaticFabOrganizationBundlePlacementProspectiveState {
	readonly map: TileMap;
	readonly portEquipment: PortEquipmentState;
	readonly organizations: StaticFabOrganizationState;
	readonly relationships: StaticFabAssemblyRelationshipStateV1;
}

export interface StaticFabOrganizationBundlePlacementPlanningResult {
	readonly plan: StaticFabOrganizationBundlePlacementPlan;
	readonly prospectiveState: StaticFabOrganizationBundlePlacementProspectiveState | null;
}

interface ProspectiveStateCapture {
	state: StaticFabOrganizationBundlePlacementProspectiveState | null;
}

interface StaticFabOrganizationBundlePlacementSource {
	readonly map: TileMap;
	readonly portEquipment: PortEquipmentState;
	readonly organizations: StaticFabOrganizationState;
	readonly relationships: StaticFabAssemblyRelationshipStateV1;
	readonly sourceChecksum: string | null;
}

interface StaticFabOrganizationBundlePlacementPermitSource
	extends StaticFabOrganizationBundlePlacementSource {
	readonly baseRevision: number;
	readonly basePatchSequence: number;
	readonly sourceNextAdvancedSwitchId: number;
	readonly sourceNextPortId: number;
	readonly sourceNextEquipmentGroupId: number;
	readonly sourceNextOrganizationId: number;
	readonly sourceNextRelationshipId: number;
	readonly bundleFingerprint: string;
	readonly anchor: Cell;
	readonly quarterTurns: StaticFabOrganizationBundleQuarterTurns;
}

const issuedPlans = new WeakMap<object, StaticFabOrganizationBundlePlacementSource>();
const certifiedPlans = new WeakMap<
	object,
	StaticFabOrganizationBundlePlacementSource & {
		readonly sourceChecksum: string;
		readonly planFingerprint: string;
	}
>();
const pendingWorkerPermits = new WeakMap<
	object,
	StaticFabOrganizationBundlePlacementPermitSource
>();
const bundleFingerprints = new WeakMap<object, string>();
let nextWorkerTicketId = 1;

export function isIssuedStaticFabOrganizationBundlePlacementPlan(
	plan: StaticFabOrganizationBundlePlacementPlan,
): boolean {
	return issuedPlans.has(plan);
}

export function isStaticFabOrganizationBundlePlacementPlanIssuedFor(
	plan: StaticFabOrganizationBundlePlacementPlan,
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

export function isCertifiedStaticFabOrganizationBundlePlacementPlanIssuedFor(
	plan: StaticFabOrganizationBundlePlacementPlan,
	map: TileMap,
	portEquipment: PortEquipmentState,
	organizations: StaticFabOrganizationState,
	relationships: StaticFabAssemblyRelationshipStateV1,
): boolean {
	const certification = certifiedPlans.get(plan);
	return (
		certification?.map === map &&
		certification.portEquipment === portEquipment &&
		certification.organizations === organizations &&
		certification.relationships === relationships &&
		plan.baseRevision === map.getRevision() &&
		certification.planFingerprint === staticFabOrganizationBundlePlacementFingerprint(plan)
	);
}

/** Consume certification before an atomic document commit so the same plan can never be replayed. */
export function consumeCertifiedStaticFabOrganizationBundlePlacementPlanIssuedFor(
	plan: StaticFabOrganizationBundlePlacementPlan,
	map: TileMap,
	portEquipment: PortEquipmentState,
	organizations: StaticFabOrganizationState,
	relationships: StaticFabAssemblyRelationshipStateV1,
): boolean {
	if (
		!isCertifiedStaticFabOrganizationBundlePlacementPlanIssuedFor(
			plan,
			map,
			portEquipment,
			organizations,
			relationships,
		)
	) {
		return false;
	}
	certifiedPlans.delete(plan);
	issuedPlans.delete(plan);
	return true;
}

/**
 * Create one identity-bound authority before transferring the source snapshot. Bundle hashing is
 * cached on the recursively frozen portable graph, so an active placement session pays this cost
 * before pointer-down rather than on the click frame.
 */
export function issueStaticFabOrganizationBundlePlacementPermit(
	map: TileMap,
	portEquipment: PortEquipmentState,
	basePatchSequence: number,
	organizations: StaticFabOrganizationState,
	relationships: StaticFabAssemblyRelationshipStateV1,
	bundleInput: unknown,
	anchor: Cell,
	quarterTurns: StaticFabOrganizationBundleQuarterTurns,
	sourceChecksum: string,
): StaticFabOrganizationBundlePlacementPermit {
	if (!Number.isSafeInteger(basePatchSequence) || basePatchSequence < 0) {
		throw new RangeError("Organization-bundle placement patch sequence is invalid.");
	}
	if (!Number.isSafeInteger(anchor.x) || !Number.isSafeInteger(anchor.y)) {
		throw new RangeError("Organization-bundle placement anchor is invalid.");
	}
	if (quarterTurns !== 0 && quarterTurns !== 1 && quarterTurns !== 2 && quarterTurns !== 3) {
		throw new RangeError("Organization-bundle placement rotation is invalid.");
	}
	if (typeof sourceChecksum !== "string" || sourceChecksum.length === 0) {
		throw new TypeError("Organization-bundle placement source checksum is missing.");
	}
	if (!Number.isSafeInteger(nextWorkerTicketId)) {
		throw new RangeError("Organization-bundle placement ticket sequence is exhausted.");
	}
	const bundleFingerprint = staticFabOrganizationBundleFingerprint(bundleInput);
	const permit = Object.freeze({ ticketId: nextWorkerTicketId++ });
	pendingWorkerPermits.set(
		permit,
		Object.freeze({
			map,
			portEquipment,
			organizations,
			relationships,
			sourceChecksum,
			baseRevision: map.getRevision(),
			basePatchSequence,
			sourceNextAdvancedSwitchId: map.getAdvancedSwitchIdCursor(),
			sourceNextPortId: portEquipment.nextPortId,
			sourceNextEquipmentGroupId: portEquipment.nextEquipmentGroupId,
			sourceNextOrganizationId: organizations.nextOrganizationId,
			sourceNextRelationshipId: relationships.nextRelationshipId,
			bundleFingerprint,
			anchor: Object.freeze({ x: anchor.x, y: anchor.y }),
			quarterTurns,
		}),
	);
	return permit;
}

/** Revoke an abandoned request without ever making its future Worker response adoptable. */
export function revokeStaticFabOrganizationBundlePlacementPermit(
	permit: StaticFabOrganizationBundlePlacementPermit,
): void {
	pendingWorkerPermits.delete(permit);
}

/**
 * Adopt one structured-cloned Worker plan into the main-thread issued-plan registry. The permit is
 * consumed before any check, so malformed, stale, forged, and replayed responses all fail closed.
 */
export function adoptStaticFabOrganizationBundlePlacementWorkerPlan(
	permit: StaticFabOrganizationBundlePlacementPermit,
	plan: StaticFabOrganizationBundlePlacementPlan,
	ticket: StaticFabOrganizationBundlePlacementWorkerTicket,
	expectedProspectiveChecksum: string,
	map: TileMap,
	portEquipment: PortEquipmentState,
	organizations: StaticFabOrganizationState,
	relationships: StaticFabAssemblyRelationshipStateV1,
): StaticFabOrganizationBundlePlacementPlan | null {
	const source = pendingWorkerPermits.get(permit);
	pendingWorkerPermits.delete(permit);
	if (!source) return null;
	try {
		if (
			permit.ticketId !== ticket.ticketId ||
			source.sourceChecksum === null ||
			source.map !== map ||
			source.portEquipment !== portEquipment ||
			source.organizations !== organizations ||
			source.relationships !== relationships ||
			map.getRevision() !== source.baseRevision ||
			plan.baseRevision !== source.baseRevision ||
			plan.basePatchSequence !== source.basePatchSequence ||
			plan.nextOrganizationIdBefore !== source.sourceNextOrganizationId ||
			plan.nextRelationshipIdBefore !== source.sourceNextRelationshipId ||
			ticket.sourceRevision !== source.baseRevision ||
			ticket.sourcePatchSequence !== source.basePatchSequence ||
			ticket.sourceChecksum !== source.sourceChecksum ||
			ticket.sourceNextAdvancedSwitchId !== source.sourceNextAdvancedSwitchId ||
			ticket.sourceNextPortId !== source.sourceNextPortId ||
			ticket.sourceNextEquipmentGroupId !== source.sourceNextEquipmentGroupId ||
			ticket.sourceNextOrganizationId !== source.sourceNextOrganizationId ||
			ticket.sourceNextRelationshipId !== source.sourceNextRelationshipId ||
			relationships.nextRelationshipId !== source.sourceNextRelationshipId ||
			map.getAdvancedSwitchIdCursor() !== source.sourceNextAdvancedSwitchId ||
			portEquipment.nextPortId !== source.sourceNextPortId ||
			portEquipment.nextEquipmentGroupId !== source.sourceNextEquipmentGroupId ||
			ticket.bundleFingerprint !== source.bundleFingerprint ||
			ticket.anchor.x !== source.anchor.x ||
			ticket.anchor.y !== source.anchor.y ||
			ticket.quarterTurns !== source.quarterTurns ||
			plan.organizationBundle.anchor.x !== source.anchor.x ||
			plan.organizationBundle.anchor.y !== source.anchor.y ||
			plan.organizationBundle.quarterTurns !== source.quarterTurns ||
			ticket.prospectiveNextAdvancedSwitchId !==
				nextRecordCursor(source.sourceNextAdvancedSwitchId, plan.switchMutations) ||
			ticket.prospectiveNextPortId !==
				nextRecordCursor(source.sourceNextPortId, plan.portMutations) ||
			ticket.prospectiveNextEquipmentGroupId !==
				nextRecordCursor(source.sourceNextEquipmentGroupId, plan.equipmentGroupMutations) ||
			ticket.prospectiveNextOrganizationId !== plan.nextOrganizationIdAfter ||
			ticket.prospectiveNextRelationshipId !== plan.nextRelationshipIdAfter ||
			plan.nextRelationshipIdAfter !==
				nextRecordCursor(source.sourceNextRelationshipId, plan.relationshipMutations) ||
			ticket.validationLevel !== "exact" ||
			typeof expectedProspectiveChecksum !== "string" ||
			expectedProspectiveChecksum.length === 0 ||
			typeof ticket.prospectiveChecksum !== "string" ||
			ticket.prospectiveChecksum.length === 0 ||
			ticket.prospectiveChecksum !== expectedProspectiveChecksum ||
			!plan.valid ||
			plan.kind !== "build"
		) {
			return null;
		}
		const planFingerprint = staticFabOrganizationBundlePlacementFingerprint(plan);
		if (ticket.planFingerprint !== planFingerprint) return null;
		const adoptedPlan = copyWorkerPlacementPlan(plan);
		if (staticFabOrganizationBundlePlacementFingerprint(adoptedPlan) !== planFingerprint) {
			return null;
		}
		const issuedSource = Object.freeze({
			map,
			portEquipment,
			organizations,
			relationships,
			sourceChecksum: source.sourceChecksum,
		});
		issuedPlans.set(adoptedPlan, issuedSource);
		certifiedPlans.set(
			adoptedPlan,
			Object.freeze({
				...issuedSource,
				sourceChecksum: source.sourceChecksum,
				planFingerprint,
			}),
		);
		return adoptedPlan;
	} catch {
		return null;
	}
}

/** Stable identity of a canonical portable bundle, independent of runtime IDs and placement. */
export function staticFabOrganizationBundleFingerprint(bundleInput: unknown): string {
	const prepared = prepareStaticFabOrganizationBundle(bundleInput);
	if (!prepared.valid) {
		throw new TypeError(`Invalid static FAB organization bundle: ${prepared.reason}`);
	}
	const bundle = prepared.bundle;
	const cached = bundleFingerprints.get(bundle);
	if (cached) return cached;
	const checksum = new OrderedTypedChecksum();
	completeCooperativeSteps(addStaticFabOrganizationBundleToChecksumSteps(checksum, bundle));
	const fingerprint = checksum.digest();
	bundleFingerprints.set(bundle, fingerprint);
	return fingerprint;
}

/** Hash the same canonical fields in bounded steps; only fully validated frozen data is cached. */
export async function fingerprintFrozenStaticFabOrganizationBundleCooperatively(
	input: unknown,
	checkpoint: () => Promise<void>,
	operationBudget = 128,
): Promise<string> {
	const bundle = await validateFrozenStaticFabOrganizationBundle(
		input,
		checkpoint,
		operationBudget,
	);
	const cached = bundleFingerprints.get(bundle);
	if (cached) return cached;
	const checksum = new OrderedTypedChecksum();
	const task = createCooperativeTask(
		addStaticFabOrganizationBundleToChecksumSteps(checksum, bundle),
	);
	while (!task.done) {
		task.step(operationBudget);
		await checkpoint();
	}
	task.finish();
	const fingerprint = checksum.digest();
	await checkpoint();
	bundleFingerprints.set(bundle, fingerprint);
	return fingerprint;
}

/** Stable identity of every authored mutation carried by a placement proposal. */
export function staticFabOrganizationBundlePlacementFingerprint(
	plan: StaticFabOrganizationBundlePlacementPlan,
): string {
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings([STATIC_FAB_ORGANIZATION_BUNDLE_PLACEMENT_KIND, plan.kind]);
	checksum.addNumbers([
		plan.baseRevision,
		plan.basePatchSequence,
		plan.nextOrganizationIdBefore,
		plan.nextOrganizationIdAfter,
		plan.nextRelationshipIdBefore,
		plan.nextRelationshipIdAfter,
		plan.valid ? 1 : 0,
	]);
	checksum.addNumbers(
		plan.mutations.flatMap((mutation) => [mutation.x, mutation.y, mutation.before, mutation.after]),
	);
	addAdvancedSwitchMutationsToChecksum(checksum, plan.switchMutations);
	addPortMutationsToChecksum(checksum, plan.portMutations);
	addEquipmentGroupMutationsToChecksum(checksum, plan.equipmentGroupMutations);
	addOrganizationMutationsToChecksum(checksum, plan.organizationMutations);
	checksum.addNumbers([plan.relationshipMutations.length]);
	for (const mutation of plan.relationshipMutations) {
		checksum.addNumbers([
			mutation.id,
			mutation.before === null ? 0 : 1,
			mutation.after === null ? 0 : 1,
		]);
		if (mutation.before)
			checksum.addString(checksumStaticFabAssemblyRelationshipRecord(mutation.before));
		if (mutation.after)
			checksum.addString(checksumStaticFabAssemblyRelationshipRecord(mutation.after));
	}
	checksum.addStrings([
		plan.organizationBundle.collisionPolicy,
		...plan.organizationBundle.organizationNames,
	]);
	checksum.addNumbers([
		plan.organizationBundle.anchor.x,
		plan.organizationBundle.anchor.y,
		plan.organizationBundle.quarterTurns,
		plan.organizationBundle.sourceModuleCount,
		plan.organizationBundle.railEdgeCount,
		plan.organizationBundle.advancedSwitchCount,
		plan.organizationBundle.portCount,
		plan.organizationBundle.equipmentGroupCount,
		plan.organizationBundle.organizationCount,
		plan.organizationBundle.relationshipCount,
		plan.organizationBundle.widthMeters,
		plan.organizationBundle.heightMeters,
	]);
	return checksum.digest();
}

function copyWorkerPlacementPlan(
	plan: StaticFabOrganizationBundlePlacementPlan,
): StaticFabOrganizationBundlePlacementPlan {
	return Object.freeze({
		...plan,
		cells: Object.freeze(plan.cells.map((cell) => Object.freeze({ x: cell.x, y: cell.y }))),
		mutations: Object.freeze(
			plan.mutations.map((mutation) =>
				Object.freeze({
					x: mutation.x,
					y: mutation.y,
					before: mutation.before,
					after: mutation.after,
				}),
			),
		),
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
		relationshipMutations: Object.freeze(
			plan.relationshipMutations.map((mutation) =>
				Object.freeze({
					id: mutation.id,
					before: mutation.before ? copyStaticFabAssemblyRelationshipRecord(mutation.before) : null,
					after: mutation.after ? copyStaticFabAssemblyRelationshipRecord(mutation.after) : null,
				}),
			),
		),
		conflicts: Object.freeze(plan.conflicts.map((cell) => Object.freeze({ x: cell.x, y: cell.y }))),
		organizationBundle: Object.freeze({
			...plan.organizationBundle,
			anchor: Object.freeze({
				x: plan.organizationBundle.anchor.x,
				y: plan.organizationBundle.anchor.y,
			}),
			organizationNames: Object.freeze([...plan.organizationBundle.organizationNames]),
		}),
	} satisfies StaticFabOrganizationBundlePlacementPlan);
}

function nextRecordCursor(
	sourceCursor: number,
	mutations: readonly { readonly after: { readonly id: number } | null }[],
): number {
	let cursor = sourceCursor;
	for (const mutation of mutations) {
		if (mutation.after && mutation.after.id >= cursor) cursor = mutation.after.id + 1;
	}
	return cursor;
}

/**
 * Plan a strict empty-footprint placement. Compatible seam merging is deliberately a later
 * placement policy; this first command never rewrites or silently absorbs existing authored truth.
 */
export function planStaticFabOrganizationBundlePlacement(
	map: TileMap,
	portEquipment: PortEquipmentState,
	basePatchSequence: number,
	organizations: StaticFabOrganizationState,
	relationships: StaticFabAssemblyRelationshipStateV1,
	bundleInput: unknown,
	anchor: Cell,
	quarterTurns: StaticFabOrganizationBundleQuarterTurns,
	sourceChecksum: string | null,
): StaticFabOrganizationBundlePlacementPlan {
	return planStaticFabOrganizationBundlePlacementInternal(
		map,
		portEquipment,
		basePatchSequence,
		organizations,
		relationships,
		bundleInput,
		anchor,
		quarterTurns,
		sourceChecksum,
	);
}

/**
 * Worker-only planning path that retains the already validated prospective state. The exact
 * Worker can compile and checksum this state without cloning and replaying every domain mutation.
 */
export function planStaticFabOrganizationBundlePlacementWithProspectiveState(
	map: TileMap,
	portEquipment: PortEquipmentState,
	basePatchSequence: number,
	organizations: StaticFabOrganizationState,
	relationships: StaticFabAssemblyRelationshipStateV1,
	bundleInput: unknown,
	anchor: Cell,
	quarterTurns: StaticFabOrganizationBundleQuarterTurns,
	sourceChecksum: string | null,
): StaticFabOrganizationBundlePlacementPlanningResult {
	const capture: ProspectiveStateCapture = { state: null };
	const plan = planStaticFabOrganizationBundlePlacementInternal(
		map,
		portEquipment,
		basePatchSequence,
		organizations,
		relationships,
		bundleInput,
		anchor,
		quarterTurns,
		sourceChecksum,
		capture,
	);
	return Object.freeze({ plan, prospectiveState: capture.state });
}

function planStaticFabOrganizationBundlePlacementInternal(
	map: TileMap,
	portEquipment: PortEquipmentState,
	basePatchSequence: number,
	organizations: StaticFabOrganizationState,
	relationships: StaticFabAssemblyRelationshipStateV1,
	bundleInput: unknown,
	anchor: Cell,
	quarterTurns: StaticFabOrganizationBundleQuarterTurns,
	sourceChecksum: string | null,
	capture?: ProspectiveStateCapture,
): StaticFabOrganizationBundlePlacementPlan {
	const sourceError = sourceStateError(
		map,
		portEquipment,
		basePatchSequence,
		organizations,
		relationships,
	);
	if (sourceError) {
		return invalidPlan(
			map,
			basePatchSequence,
			organizations,
			relationships,
			anchor,
			quarterTurns,
			sourceError,
		);
	}
	const preparedBundle = prepareStaticFabOrganizationBundle(bundleInput);
	if (!preparedBundle.valid) {
		return invalidPlan(
			map,
			basePatchSequence,
			organizations,
			relationships,
			anchor,
			quarterTurns,
			`조직 청사진이 유효하지 않습니다 · ${preparedBundle.reason}`,
		);
	}

	let materialized: MaterializedStaticFabOrganizationBundle;
	try {
		materialized = materializeStaticFabOrganizationBundle(
			preparedBundle.bundle,
			anchor,
			quarterTurns,
		);
	} catch (error) {
		return invalidPlan(
			map,
			basePatchSequence,
			organizations,
			relationships,
			anchor,
			quarterTurns,
			caughtMessage(error, "조직 청사진 좌표를 변환할 수 없습니다"),
		);
	}

	const rail = buildRailMutations(map, materialized);
	if (!rail.valid) {
		return invalidPlan(
			map,
			basePatchSequence,
			organizations,
			relationships,
			anchor,
			quarterTurns,
			rail.reason,
			rail.conflicts,
			materialized,
		);
	}

	let records: InstantiatedPortableRecords;
	try {
		records = instantiatePortableRecords(
			map,
			portEquipment,
			organizations,
			relationships,
			materialized,
		);
	} catch (error) {
		return invalidPlan(
			map,
			basePatchSequence,
			organizations,
			relationships,
			anchor,
			quarterTurns,
			caughtMessage(error, "조직 청사진 ID를 할당할 수 없습니다"),
			[],
			materialized,
		);
	}

	const topologyError = railMutationTopologyError(map, rail.mutations, records.switchMutations);
	if (topologyError) {
		return invalidPlan(
			map,
			basePatchSequence,
			organizations,
			relationships,
			anchor,
			quarterTurns,
			`조직 청사진 레일 topology가 유효하지 않습니다 · ${topologyError}`,
			rail.cells,
			materialized,
		);
	}

	let prospectiveState: StaticFabOrganizationBundlePlacementProspectiveState | null = null;
	try {
		const prospectiveMap = map.clone();
		if (!prospectiveMap.applyAtomicMutations(rail.mutations, records.switchMutations)) {
			throw new Error("레일 또는 switch mutation의 before 상태가 현재 맵과 일치하지 않습니다");
		}
		const prospectiveEquipment = applyPortEquipmentMutations(
			portEquipment,
			records.portMutations,
			records.equipmentGroupMutations,
		);
		const equipmentError = portEquipmentLayoutError(prospectiveMap, prospectiveEquipment);
		if (equipmentError) throw new Error(equipmentError);
		const prospectiveOrganizations = applyStaticFabOrganizationMutations(
			organizations,
			records.organizationMutations,
			records.nextOrganizationIdAfter,
		);
		const organizationError = staticFabOrganizationStateError(
			prospectiveMap,
			prospectiveEquipment,
			prospectiveOrganizations,
		);
		if (organizationError) throw new Error(organizationError);
		const prospectiveRelationships = applyStaticFabAssemblyRelationshipMutations(
			relationships,
			records.relationshipMutations,
			records.nextRelationshipIdAfter,
		);
		const relationshipError = staticFabAssemblyRelationshipStateSourceError(
			prospectiveMap,
			prospectiveOrganizations,
			prospectiveRelationships,
		);
		if (relationshipError) throw new Error(relationshipError);
		prospectiveState = Object.freeze({
			map: prospectiveMap,
			portEquipment: prospectiveEquipment,
			organizations: prospectiveOrganizations,
			relationships: prospectiveRelationships,
		});
	} catch (error) {
		return invalidPlan(
			map,
			basePatchSequence,
			organizations,
			relationships,
			anchor,
			quarterTurns,
			`조직 청사진 최종 상태가 유효하지 않습니다 · ${caughtMessage(error, "unknown validation error")}`,
			rail.cells,
			materialized,
		);
	}
	if (capture) capture.state = prospectiveState;

	const plan = Object.freeze({
		kind: "build" as const,
		baseRevision: map.getRevision(),
		basePatchSequence,
		cells: rail.cells,
		mutations: rail.mutations,
		switchMutations: records.switchMutations,
		portMutations: records.portMutations,
		equipmentGroupMutations: records.equipmentGroupMutations,
		organizationMutations: records.organizationMutations,
		relationshipMutations: records.relationshipMutations,
		nextRelationshipIdBefore: relationships.nextRelationshipId,
		nextRelationshipIdAfter: records.nextRelationshipIdAfter,
		nextOrganizationIdBefore: organizations.nextOrganizationId,
		nextOrganizationIdAfter: records.nextOrganizationIdAfter,
		valid: true,
		reason: `레일 모듈 ${materialized.sourceModuleCount}개 · 장비 ${materialized.equipmentGroups.length}개 · 조직 ${materialized.organizations.length}개를 한 번에 배치합니다`,
		issueCode: null,
		conflicts: Object.freeze([]),
		newEdges: materialized.railEdges.length,
		lengthMeters: materialized.railEdges.length,
		turns: countTurns(materialized),
		bend: "horizontal-first" as const,
		organizationBundle: placementMetadata(materialized, records.organizationNames),
	} satisfies StaticFabOrganizationBundlePlacementPlan);
	issuedPlans.set(
		plan,
		Object.freeze({ map, portEquipment, organizations, relationships, sourceChecksum }),
	);
	return plan;
}

interface RailMutationBuildResult {
	readonly valid: boolean;
	readonly reason: string;
	readonly cells: readonly Cell[];
	readonly mutations: readonly RailMutation[];
	readonly conflicts: readonly Cell[];
}

function buildRailMutations(
	map: TileMap,
	bundle: MaterializedStaticFabOrganizationBundle,
): RailMutationBuildResult {
	const afterByCell = new Map<string, { x: number; y: number; encoded: number }>();
	const conflicts = new Map<string, Cell>();
	const stateAt = (cell: Cell) => {
		const key = cellKey(cell.x, cell.y);
		const existing = afterByCell.get(key);
		if (existing) return existing;
		const created = { x: cell.x, y: cell.y, encoded: 0 };
		afterByCell.set(key, created);
		return created;
	};
	for (const edge of bundle.railEdges) {
		const direction = directionBetween(edge.from, edge.to);
		if (direction === null) {
			return emptyRailFailure("조직 청사진에 인접하지 않은 레일 edge가 있습니다");
		}
		const from = stateAt(edge.from);
		const to = stateAt(edge.to);
		const fromState = decodeRailCell(from.encoded);
		const toState = decodeRailCell(to.encoded);
		from.encoded = encodeRailCell({
			incoming: fromState.incoming,
			outgoing: fromState.outgoing | direction,
		});
		to.encoded = encodeRailCell({
			incoming: toState.incoming | oppositeDirection(direction),
			outgoing: toState.outgoing,
		});
	}
	for (const state of afterByCell.values()) {
		if (
			map.getEncoded(state.x, state.y) !== 0 ||
			map.getAdvancedSwitchOwningCell(state.x, state.y)
		) {
			conflicts.set(cellKey(state.x, state.y), Object.freeze({ x: state.x, y: state.y }));
		}
	}
	for (let index = 0; index < bundle.advancedSwitches.length; index++) {
		const portable = bundle.advancedSwitches[index];
		if (!portable) continue;
		const geometry = deriveAdvancedSwitchGeometry({ id: index + 1, ...portable });
		for (const cell of geometry.claimedCells) {
			if (map.getEncoded(cell.x, cell.y) !== 0 || map.getAdvancedSwitchOwningCell(cell.x, cell.y)) {
				conflicts.set(cellKey(cell.x, cell.y), Object.freeze({ ...cell }));
			}
		}
	}
	const cells = Object.freeze(
		[...afterByCell.values()]
			.map((state) => Object.freeze({ x: state.x, y: state.y }))
			.sort(compareCells),
	);
	if (conflicts.size > 0) {
		return Object.freeze({
			valid: false,
			reason: "조직 청사진은 현재 빈 footprint에만 배치할 수 있습니다",
			cells,
			mutations: Object.freeze([]),
			conflicts: Object.freeze([...conflicts.values()].sort(compareCells)),
		});
	}
	const mutations = Object.freeze(
		[...afterByCell.values()].sort(compareCells).map((state) =>
			Object.freeze({
				x: state.x,
				y: state.y,
				before: 0,
				after: state.encoded,
			}),
		),
	);
	return Object.freeze({
		valid: true,
		reason: "조직 청사진 레일 footprint를 배치할 수 있습니다",
		cells,
		mutations,
		conflicts: Object.freeze([]),
	});
}

interface InstantiatedPortableRecords {
	readonly switchMutations: readonly AdvancedSwitchMutation[];
	readonly portMutations: readonly PortMutation[];
	readonly equipmentGroupMutations: readonly EquipmentGroupMutation[];
	readonly organizationMutations: readonly StaticFabOrganizationMutation[];
	readonly relationshipMutations: readonly StaticFabAssemblyRelationshipMutationV1[];
	readonly nextRelationshipIdAfter: number;
	readonly nextOrganizationIdAfter: number;
	readonly organizationNames: readonly string[];
}

function instantiatePortableRecords(
	map: TileMap,
	portEquipment: PortEquipmentState,
	organizations: StaticFabOrganizationState,
	relationships: StaticFabAssemblyRelationshipStateV1,
	bundle: MaterializedStaticFabOrganizationBundle,
): InstantiatedPortableRecords {
	const switchIds = allocateSwitchIds(map, bundle.advancedSwitches.length);
	const recordIds = allocatePortEquipmentRecordIds(
		portEquipment,
		bundle.ports.length,
		bundle.equipmentGroups.length,
	);
	const organizationIds = allocateOrganizationIds(organizations, bundle.organizations.length);

	const switchMutations = Object.freeze(
		bundle.advancedSwitches.map((portable, index) => {
			const after = copyAdvancedSwitch({
				id: switchIds[index] as number,
				profileClass: portable.profileClass,
				origin: portable.origin,
				forward: portable.forward,
				lateral: portable.lateral,
				movementMask: portable.movementMask,
			});
			return Object.freeze({ id: after.id, before: null, after });
		}),
	);

	const provisionalPorts: PortRecord[] = bundle.ports.map((portable, index) => {
		const equipmentGroupId = recordIds.equipmentGroupIds[portable.equipmentGroupIndex];
		if (equipmentGroupId === undefined) {
			throw new Error(`조직 청사진 PORT-${index}의 장비 그룹 index가 유효하지 않습니다`);
		}
		const route =
			portable.route.kind === "CARDINAL_CELL"
				? Object.freeze({ ...portable.route })
				: Object.freeze({
						kind: "ADVANCED_SWITCH_SEGMENT" as const,
						switchId: requiredLocalId(switchIds, portable.route.advancedSwitchIndex, "고급 스위치"),
						profileClass: portable.route.profileClass,
						role: portable.route.role,
						portIndex: portable.route.portIndex,
						segmentOrdinal: portable.route.segmentOrdinal,
					});
		return {
			id: recordIds.portIds[index] as number,
			equipmentGroupId,
			route,
			stationMillimeters: portable.stationMillimeters,
			side: portable.side,
			lateralOffsetMillimeters: portable.lateralOffsetMillimeters,
			direction: portable.direction,
			portType: portable.portType,
			barcode: null,
		} satisfies PortRecord;
	});
	const equipmentGroups = bundle.equipmentGroups.map((portable, index) =>
		instantiateEquipmentGroup(
			portable,
			recordIds.equipmentGroupIds[index] as number,
			provisionalPorts,
			recordIds.portIds,
		),
	);
	const groupsById = new Map(equipmentGroups.map((group) => [group.id, group] as const));
	const portsById = new Map(provisionalPorts.map((port) => [port.id, port] as const));
	for (const group of equipmentGroups) {
		for (let portIndex = 0; portIndex < group.portIds.length; portIndex++) {
			const portId = group.portIds[portIndex] as number;
			const port = portsById.get(portId);
			if (!port) throw new Error(`조직 청사진 PORT-${portId}를 찾을 수 없습니다`);
			portsById.set(portId, {
				...port,
				barcode: equipmentGroupPortBarcode(group.kind, group.id, portId, portIndex),
			});
		}
	}
	const ports = provisionalPorts.map((port) =>
		copyPortRecord(portsById.get(port.id) as PortRecord),
	);
	const portMutations = Object.freeze(
		ports.map((port) => Object.freeze({ id: port.id, before: null, after: port })),
	);
	const equipmentGroupMutations = Object.freeze(
		equipmentGroups.map((group) => {
			const after = copyEquipmentGroupRecord(groupsById.get(group.id) as EquipmentGroupRecord);
			return Object.freeze({ id: after.id, before: null, after });
		}),
	);

	const organizationNames = allocateOrganizationNames(organizations, bundle);
	const organizationMutations = Object.freeze(
		bundle.organizations.map((portable, index) => {
			const id = organizationIds[index] as number;
			const after = copyStaticFabOrganizationRecord({
				id,
				kind: portable.kind,
				name: organizationNames[index] as string,
				parentOrganizationIds: portable.parentOrganizationIndices.map((parentIndex) =>
					requiredLocalId(organizationIds, parentIndex, "부모 조직"),
				),
				properties: { ...portable.properties },
				membership: {
					railEdges: portable.membership.railEdgeIndices
						.map((edgeIndex) => {
							const edge = bundle.railEdges[edgeIndex];
							if (!edge) throw new Error(`조직 ${index}의 rail edge index가 유효하지 않습니다`);
							return edge;
						})
						.sort(compareDirectedRailEdges),
					advancedSwitchIds: portable.membership.advancedSwitchIndices.map((switchIndex) =>
						requiredLocalId(switchIds, switchIndex, "고급 스위치"),
					),
					equipmentGroupIds: portable.membership.equipmentGroupIndices.map((groupIndex) =>
						requiredLocalId(recordIds.equipmentGroupIds, groupIndex, "장비 그룹"),
					),
				},
			});
			return Object.freeze({ id, before: null, after });
		}),
	);
	const nextRelationshipIdAfter =
		relationships.nextRelationshipId + bundle.relationships.records.length;
	if (nextRelationshipIdAfter > 0x7fff_ffff)
		throw new Error("조립 관계 ID를 안전하게 할당할 수 없습니다");
	const localOrganizationIds = new Map(
		organizationIds.map((id, index) => [index + 1, id] as const),
	);
	const relationshipMutations = Object.freeze(
		bundle.relationships.records.map((record, index) => {
			const id = relationships.nextRelationshipId + index;
			const after = remapStaticFabAssemblyRelationshipRecord(record, {
				relationshipId: id,
				organizationIds: localOrganizationIds,
				quarterTurns: 0,
				offset: { x: 0, y: 0 },
			});
			return Object.freeze({ id, before: null, after });
		}),
	);
	return Object.freeze({
		switchMutations,
		portMutations,
		equipmentGroupMutations,
		organizationMutations,
		relationshipMutations,
		nextRelationshipIdAfter,
		nextOrganizationIdAfter: organizations.nextOrganizationId + organizationIds.length,
		organizationNames,
	});
}

function instantiateEquipmentGroup(
	template: StaticFabOrganizationBundleEquipmentGroup,
	id: number,
	ports: readonly PortRecord[],
	portIds: readonly number[],
): EquipmentGroupRecord {
	const candidateIds = template.portIndices.map((index) => requiredLocalId(portIds, index, "PORT"));
	const canonicalIds = canonicalEquipmentGroupPortIds(template, candidateIds, ports);
	if (template.kind === "OHB") {
		return Object.freeze({ id, kind: "OHB", template: "SINGLE", portIds: canonicalIds });
	}
	if (template.kind === "EQ") {
		return Object.freeze({
			id,
			kind: "EQ",
			pitchMillimeters: template.pitchMillimeters,
			recipe: template.recipe,
			portIds: canonicalIds,
		});
	}
	return Object.freeze({ id, kind: "STK", template: template.template, portIds: canonicalIds });
}

function allocateSwitchIds(map: TileMap, count: number): readonly number[] {
	const cursor = map.getAdvancedSwitchIdCursor();
	if (count > 0 && cursor + count - 1 > ADVANCED_SWITCH_MAX_ID) {
		throw new RangeError("고급 스위치 signed-int32 ID가 부족합니다");
	}
	return Object.freeze(Array.from({ length: count }, (_, index) => cursor + index));
}

function allocateOrganizationIds(
	state: StaticFabOrganizationState,
	count: number,
): readonly number[] {
	if (count > 0 && state.nextOrganizationId + count > 0x7fff_ffff) {
		throw new RangeError("정적 FAB 조직 signed-int32 ID가 부족합니다");
	}
	return Object.freeze(
		Array.from({ length: count }, (_, index) => state.nextOrganizationId + index),
	);
}

function allocateOrganizationNames(
	state: StaticFabOrganizationState,
	bundle: MaterializedStaticFabOrganizationBundle,
): readonly string[] {
	const used = new Map<StaticFabOrganizationKind, Set<string>>();
	for (const record of state.records) {
		const names = used.get(record.kind) ?? new Set<string>();
		names.add(normalizeStaticFabOrganizationName(record.name));
		used.set(record.kind, names);
	}
	return Object.freeze(
		bundle.organizations.map((organization) => {
			const names = used.get(organization.kind) ?? new Set<string>();
			let candidate = organization.name;
			for (let copy = 1; names.has(normalizeStaticFabOrganizationName(candidate)); copy++) {
				const suffix = copy === 1 ? " copy" : ` copy ${copy}`;
				candidate = `${organization.name.slice(0, Math.max(1, 120 - suffix.length)).trimEnd()}${suffix}`;
			}
			names.add(normalizeStaticFabOrganizationName(candidate));
			used.set(organization.kind, names);
			return candidate;
		}),
	);
}

function sourceStateError(
	map: TileMap,
	portEquipment: PortEquipmentState,
	basePatchSequence: number,
	organizations: StaticFabOrganizationState,
	relationships: StaticFabAssemblyRelationshipStateV1,
): string | null {
	if (!Number.isSafeInteger(basePatchSequence) || basePatchSequence < 0) {
		return "조직 청사진 patch sequence가 유효하지 않습니다";
	}
	const equipmentError = portEquipmentLayoutError(map, portEquipment);
	if (equipmentError) return `현재 포트/장비 상태가 유효하지 않습니다 · ${equipmentError}`;
	const organizationError = staticFabOrganizationStateError(map, portEquipment, organizations);
	if (organizationError) return `현재 조직 상태가 유효하지 않습니다 · ${organizationError}`;
	return staticFabAssemblyRelationshipStateSourceError(map, organizations, relationships);
}

function invalidPlan(
	map: TileMap,
	basePatchSequence: number,
	organizations: StaticFabOrganizationState,
	relationships: StaticFabAssemblyRelationshipStateV1,
	anchor: Cell,
	quarterTurns: StaticFabOrganizationBundleQuarterTurns,
	reason: string,
	conflicts: readonly Cell[] = [],
	bundle: MaterializedStaticFabOrganizationBundle | null = null,
): StaticFabOrganizationBundlePlacementPlan {
	return Object.freeze({
		kind: "build" as const,
		baseRevision: map.getRevision(),
		basePatchSequence,
		cells: Object.freeze([]),
		mutations: Object.freeze([]),
		switchMutations: Object.freeze([]),
		portMutations: Object.freeze([]),
		equipmentGroupMutations: Object.freeze([]),
		organizationMutations: Object.freeze([]),
		relationshipMutations: Object.freeze([]),
		nextRelationshipIdBefore: relationships.nextRelationshipId,
		nextRelationshipIdAfter: relationships.nextRelationshipId,
		nextOrganizationIdBefore: organizations.nextOrganizationId,
		nextOrganizationIdAfter: organizations.nextOrganizationId,
		valid: false,
		reason,
		issueCode: "topology" as const,
		conflicts: Object.freeze(
			conflicts.map((cell) => Object.freeze({ ...cell })).sort(compareCells),
		),
		newEdges: 0,
		lengthMeters: 0,
		turns: 0,
		bend: "horizontal-first" as const,
		organizationBundle: bundle
			? placementMetadata(bundle, [])
			: Object.freeze({
					collisionPolicy: "EMPTY_FOOTPRINT_V1" as const,
					anchor: Object.freeze({ x: anchor.x, y: anchor.y }),
					quarterTurns,
					sourceModuleCount: 0,
					railEdgeCount: 0,
					advancedSwitchCount: 0,
					portCount: 0,
					equipmentGroupCount: 0,
					organizationCount: 0,
					relationshipCount: 0,
					widthMeters: 0,
					heightMeters: 0,
					organizationNames: Object.freeze([]),
				}),
	});
}

function placementMetadata(
	bundle: MaterializedStaticFabOrganizationBundle,
	organizationNames: readonly string[],
): StaticFabOrganizationBundlePlacementMetadata {
	return Object.freeze({
		collisionPolicy: "EMPTY_FOOTPRINT_V1",
		anchor: Object.freeze({ ...bundle.anchor }),
		quarterTurns: bundle.quarterTurns,
		sourceModuleCount: bundle.sourceModuleCount,
		railEdgeCount: bundle.railEdges.length,
		advancedSwitchCount: bundle.advancedSwitches.length,
		portCount: bundle.ports.length,
		equipmentGroupCount: bundle.equipmentGroups.length,
		organizationCount: bundle.organizations.length,
		relationshipCount: bundle.relationships.records.length,
		widthMeters: bundle.widthMeters,
		heightMeters: bundle.heightMeters,
		organizationNames: Object.freeze([...organizationNames]),
	});
}

function* addStaticFabOrganizationBundleToChecksumSteps(
	checksum: OrderedTypedChecksum,
	bundle: StaticFabOrganizationBundle,
): Generator<void> {
	checksum.addStrings(["static-fab-organization-bundle", bundle.captureMode]);
	checksum.addNumbers([
		bundle.version,
		bundle.sourceModuleCount,
		bundle.sourceWidthMeters,
		bundle.sourceHeightMeters,
		...bundle.rootOrganizationIndices,
	]);
	checksum.addNumbers([bundle.railEdges.length]);
	for (const edge of bundle.railEdges) {
		checksum.addNumbers([edge.from.x, edge.from.y, edge.to.x, edge.to.y]);
		yield;
	}
	checksum.addNumbers([bundle.advancedSwitches.length]);
	for (const advancedSwitch of bundle.advancedSwitches) {
		checksum.addStrings([advancedSwitch.profileClass]);
		checksum.addNumbers([
			advancedSwitch.origin.x,
			advancedSwitch.origin.y,
			advancedSwitch.forward,
			advancedSwitch.lateral,
			advancedSwitch.movementMask,
		]);
		yield;
	}
	checksum.addNumbers([bundle.ports.length]);
	for (const port of bundle.ports) {
		checksum.addNumbers([
			port.equipmentGroupIndex,
			port.stationMillimeters,
			port.lateralOffsetMillimeters,
		]);
		checksum.addStrings([port.side, port.direction, port.portType, port.route.kind]);
		if (port.route.kind === "CARDINAL_CELL") {
			checksum.addNumbers([port.route.x, port.route.z, port.route.from, port.route.to]);
		} else {
			checksum.addStrings([port.route.profileClass, port.route.role]);
			checksum.addNumbers([
				port.route.advancedSwitchIndex,
				port.route.portIndex ?? -1,
				port.route.segmentOrdinal,
			]);
		}
		yield;
	}
	checksum.addNumbers([bundle.equipmentGroups.length]);
	for (const group of bundle.equipmentGroups) {
		checksum.addStrings([group.kind]);
		yield* checksum.addNumbersSteps(group.portIndices);
		if (group.kind === "EQ") {
			checksum.addNumbers([group.pitchMillimeters, group.recipe === null ? 0 : 1]);
			checksum.addStrings([group.recipe ?? ""]);
		} else {
			checksum.addStrings([group.template]);
		}
		yield;
	}
	checksum.addNumbers([
		bundle.relationships.nextRelationshipId,
		bundle.relationships.records.length,
	]);
	for (const relationship of bundle.relationships.records) {
		checksum.addStrings([yield* checksumStaticFabAssemblyRelationshipRecordSteps(relationship)]);
		yield;
	}
	checksum.addNumbers([bundle.organizations.length]);
	for (const organization of bundle.organizations) {
		checksum.addStrings([
			organization.kind,
			organization.name,
			organization.properties.description,
			organization.properties.color,
		]);
		yield* checksum.addNumbersSteps(organization.parentOrganizationIndices);
		yield* checksum.addNumbersSteps(organization.membership.railEdgeIndices);
		yield* checksum.addNumbersSteps(organization.membership.advancedSwitchIndices);
		yield* checksum.addNumbersSteps(organization.membership.equipmentGroupIndices);
		yield;
	}
}

function addAdvancedSwitchMutationsToChecksum(
	checksum: OrderedTypedChecksum,
	mutations: readonly AdvancedSwitchMutation[],
): void {
	checksum.addNumbers([mutations.length]);
	for (const mutation of mutations) {
		checksum.addNumbers([mutation.id]);
		addAdvancedSwitchRecordToChecksum(checksum, mutation.before);
		addAdvancedSwitchRecordToChecksum(checksum, mutation.after);
	}
}

function addAdvancedSwitchRecordToChecksum(
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

function addPortMutationsToChecksum(
	checksum: OrderedTypedChecksum,
	mutations: readonly PortMutation[],
): void {
	checksum.addNumbers([mutations.length]);
	for (const mutation of mutations) {
		checksum.addNumbers([mutation.id]);
		addPortRecordToChecksum(checksum, mutation.before);
		addPortRecordToChecksum(checksum, mutation.after);
	}
}

function addPortRecordToChecksum(checksum: OrderedTypedChecksum, record: PortRecord | null): void {
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
		return;
	}
	checksum.addNumbers([
		record.route.switchId,
		record.route.portIndex ?? -1,
		record.route.segmentOrdinal,
	]);
	checksum.addStrings([record.route.profileClass, record.route.role]);
}

function addEquipmentGroupMutationsToChecksum(
	checksum: OrderedTypedChecksum,
	mutations: readonly EquipmentGroupMutation[],
): void {
	checksum.addNumbers([mutations.length]);
	for (const mutation of mutations) {
		checksum.addNumbers([mutation.id]);
		addEquipmentGroupRecordToChecksum(checksum, mutation.before);
		addEquipmentGroupRecordToChecksum(checksum, mutation.after);
	}
}

function addEquipmentGroupRecordToChecksum(
	checksum: OrderedTypedChecksum,
	record: EquipmentGroupRecord | null,
): void {
	if (!record) {
		checksum.addNumbers([0]);
		return;
	}
	checksum.addNumbers([1, record.id, ...record.portIds]);
	checksum.addStrings([record.kind]);
	if (record.kind === "EQ") {
		checksum.addNumbers([record.pitchMillimeters]);
		checksum.addStrings([record.recipe ?? ""]);
		return;
	}
	checksum.addStrings([record.template]);
}

function addOrganizationMutationsToChecksum(
	checksum: OrderedTypedChecksum,
	mutations: readonly StaticFabOrganizationMutation[],
): void {
	checksum.addNumbers([mutations.length]);
	for (const mutation of mutations) {
		checksum.addNumbers([mutation.id]);
		addOrganizationRecordToChecksum(checksum, mutation.before);
		addOrganizationRecordToChecksum(checksum, mutation.after);
	}
}

function addOrganizationRecordToChecksum(
	checksum: OrderedTypedChecksum,
	record: StaticFabOrganizationRecord | null,
): void {
	if (!record) {
		checksum.addNumbers([0]);
		return;
	}
	checksum.addNumbers([1, record.id, ...(record.parentOrganizationIds ?? [])]);
	checksum.addStrings([
		record.kind,
		record.name,
		record.properties?.description ?? "",
		record.properties?.color ?? "",
	]);
	checksum.addNumbers(
		record.membership.railEdges.flatMap((edge) => [edge.from.x, edge.from.y, edge.to.x, edge.to.y]),
	);
	checksum.addNumbers(record.membership.advancedSwitchIds);
	checksum.addNumbers(record.membership.equipmentGroupIds);
}

function countTurns(bundle: MaterializedStaticFabOrganizationBundle): number {
	let turns = 0;
	const incomingByCell = new Map<string, number>();
	const outgoingByCell = new Map<string, number>();
	for (const edge of bundle.railEdges) {
		const direction = directionBetween(edge.from, edge.to);
		if (direction === null) continue;
		outgoingByCell.set(
			cellKey(edge.from.x, edge.from.y),
			(outgoingByCell.get(cellKey(edge.from.x, edge.from.y)) ?? 0) | direction,
		);
		incomingByCell.set(
			cellKey(edge.to.x, edge.to.y),
			(incomingByCell.get(cellKey(edge.to.x, edge.to.y)) ?? 0) | oppositeDirection(direction),
		);
	}
	for (const [key, incoming] of incomingByCell) {
		const outgoing = outgoingByCell.get(key) ?? 0;
		if (
			incoming !== 0 &&
			outgoing !== 0 &&
			(incoming & oppositeDirection(singleDirection(outgoing))) === 0
		) {
			turns++;
		}
	}
	return turns;
}

function singleDirection(mask: number): 1 | 2 | 4 | 8 {
	if (mask & 1) return 1;
	if (mask & 2) return 2;
	if (mask & 4) return 4;
	return 8;
}

function requiredLocalId(ids: readonly number[], index: number, label: string): number {
	const id = ids[index];
	if (id === undefined) throw new Error(`${label} local index ${index}가 유효하지 않습니다`);
	return id;
}

function emptyRailFailure(reason: string): RailMutationBuildResult {
	return Object.freeze({
		valid: false,
		reason,
		cells: Object.freeze([]),
		mutations: Object.freeze([]),
		conflicts: Object.freeze([]),
	});
}

function compareCells(left: Cell, right: Cell): number {
	return left.y - right.y || left.x - right.x;
}

function caughtMessage(error: unknown, fallback: string): string {
	return error instanceof Error && error.message ? error.message : fallback;
}
