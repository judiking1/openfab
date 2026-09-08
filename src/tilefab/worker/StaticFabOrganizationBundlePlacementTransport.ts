import { type AdvancedSwitchRecord, copyAdvancedSwitch } from "../core/AdvancedSwitch";
import { type CooperativeTask, createCooperativeTask } from "../core/CooperativeTask";
import type { RailMutation } from "../core/paint";
import {
	type StaticFabOrganizationBundlePlacementPlan,
	type StaticFabOrganizationBundlePlacementWorkerTicket,
	staticFabOrganizationBundlePlacementFingerprintSteps,
} from "../core/StaticFabOrganizationBundlePlacement";
import type { Cell } from "../core/TileMap";
import {
	type AdvancedSwitchRecordFieldsSoA,
	createAdvancedSwitchRecordFields,
	readAdvancedSwitchRecord,
	writeAdvancedSwitchRecord,
} from "./AdvancedSwitchSoA";
import {
	createPortEquipmentSnapshot,
	hydratePortEquipmentSnapshotCooperatively,
	type PortEquipmentSnapshot,
} from "./PortEquipmentSoA";
import {
	createStaticFabAssemblyRelationshipSnapshot,
	createStaticFabAssemblyRelationshipSnapshotHydrator,
	type StaticFabAssemblyRelationshipSnapshot,
} from "./StaticFabAssemblyRelationshipSoA";
import { createStaticFabOrganizationBundlePlacementCapture } from "./StaticFabOrganizationBundlePlacementCapture";
import type { PreparedStaticFabOrganizationBundlePlacement } from "./StaticFabOrganizationBundlePlacementProtocol";
import {
	placementTicketShapeError,
	staticFabOrganizationBundlePlacementPlanHeaderShapeError,
	staticFabOrganizationBundlePlacementPreparedEnvelopeShapeError,
	staticFabOrganizationBundlePlacementPreparedShapeError,
	staticFabOrganizationBundlePlacementPreparedShapeErrorSteps,
} from "./StaticFabOrganizationBundlePlacementResponseValidator";
import {
	createStaticFabOrganizationSnapshot,
	createStaticFabOrganizationSnapshotHydrator,
	type StaticFabOrganizationSnapshot,
} from "./StaticFabOrganizationSoA";

export const STATIC_FAB_ORGANIZATION_BUNDLE_PLACEMENT_TRANSPORT_VERSION = 1 as const;

export type StaticFabOrganizationBundlePlacementPlanHeader = Readonly<
	Omit<
		StaticFabOrganizationBundlePlacementPlan,
		| "cells"
		| "mutations"
		| "switchMutations"
		| "portMutations"
		| "equipmentGroupMutations"
		| "organizationMutations"
		| "relationshipMutations"
	>
>;

/** One addition-only representation; cells and before=0/null are reconstructed on admission. */
export interface StaticFabOrganizationBundlePlacementAdditions {
	readonly xs: Int32Array;
	readonly ys: Int32Array;
	readonly encoded: Uint8Array;
	readonly switchIds: Int32Array;
	readonly switches: AdvancedSwitchRecordFieldsSoA;
	readonly portEquipment: PortEquipmentSnapshot;
	readonly organizations: StaticFabOrganizationSnapshot;
	readonly relationships: StaticFabAssemblyRelationshipSnapshot;
}

type PreparedEnvelope = Omit<PreparedStaticFabOrganizationBundlePlacement, "plan">;

export type StaticFabOrganizationBundlePlacementTransport =
	| Readonly<{
			version: typeof STATIC_FAB_ORGANIZATION_BUNDLE_PLACEMENT_TRANSPORT_VERSION;
			kind: "compact";
			prepared: PreparedStaticFabOrganizationBundlePlacement;
	  }>
	| Readonly<{
			version: typeof STATIC_FAB_ORGANIZATION_BUNDLE_PLACEMENT_TRANSPORT_VERSION;
			kind: "additions";
			prepared: PreparedEnvelope & {
				readonly plan: StaticFabOrganizationBundlePlacementPlanHeader;
			};
			additions: StaticFabOrganizationBundlePlacementAdditions;
	  }>;

/** Worker-side encoding preserves the existing exact-plan checks before omitting implicit before data. */
export function encodeStaticFabOrganizationBundlePlacementTransport(
	prepared: PreparedStaticFabOrganizationBundlePlacement,
): StaticFabOrganizationBundlePlacementTransport {
	const error = staticFabOrganizationBundlePlacementPreparedShapeError(prepared);
	if (error) throw new Error(`Invalid placement transport source: ${error}.`);
	const envelope = copyPreparedEnvelope(prepared);
	if (!prepared.valid) {
		return Object.freeze({
			version: STATIC_FAB_ORGANIZATION_BUNDLE_PLACEMENT_TRANSPORT_VERSION,
			kind: "compact",
			prepared: Object.freeze({
				...envelope,
				plan: prepared.plan
					? Object.freeze({
							...copyPlacementPlanHeader(prepared.plan),
							cells: copyCells(prepared.plan.cells),
							mutations: Object.freeze([]),
							switchMutations: Object.freeze([]),
							portMutations: Object.freeze([]),
							equipmentGroupMutations: Object.freeze([]),
							organizationMutations: Object.freeze([]),
							relationshipMutations: Object.freeze([]),
						})
					: null,
			}),
		});
	}
	const plan = prepared.plan;
	const ticket = prepared.ticket;
	if (!plan || !ticket) throw new Error("Valid placement transport requires its plan and ticket.");
	const switches = addedRecords(plan.switchMutations);
	const switchFields = createAdvancedSwitchRecordFields(switches.length);
	for (let index = 0; index < switches.length; index++) {
		writeAdvancedSwitchRecord(switchFields, index, switches[index] as AdvancedSwitchRecord);
	}
	return Object.freeze({
		version: STATIC_FAB_ORGANIZATION_BUNDLE_PLACEMENT_TRANSPORT_VERSION,
		kind: "additions",
		prepared: Object.freeze({ ...envelope, plan: copyPlacementPlanHeader(plan) }),
		additions: Object.freeze({
			xs: Int32Array.from(plan.mutations, (mutation) => mutation.x),
			ys: Int32Array.from(plan.mutations, (mutation) => mutation.y),
			encoded: Uint8Array.from(plan.mutations, (mutation) => mutation.after),
			switchIds: Int32Array.from(switches, (record) => record.id),
			switches: switchFields,
			portEquipment: createPortEquipmentSnapshot({
				nextPortId: ticket.prospectiveNextPortId,
				nextEquipmentGroupId: ticket.prospectiveNextEquipmentGroupId,
				ports: addedRecords(plan.portMutations),
				equipmentGroups: addedRecords(plan.equipmentGroupMutations),
			}),
			organizations: createStaticFabOrganizationSnapshot({
				nextOrganizationId: plan.nextOrganizationIdAfter,
				records: addedRecords(plan.organizationMutations),
			}),
			relationships: createStaticFabAssemblyRelationshipSnapshot({
				nextRelationshipId: plan.nextRelationshipIdAfter,
				records: addedRecords(plan.relationshipMutations),
			}),
		}),
	});
}

function addedRecords<R extends { readonly id: number }>(
	mutations: readonly {
		readonly id: number;
		readonly before: R | null;
		readonly after: R | null;
	}[],
): readonly R[] {
	return mutations.map((mutation) => {
		if (mutation.before !== null || mutation.after === null || mutation.after.id !== mutation.id) {
			throw new Error("Placement transport only represents exact additions.");
		}
		return mutation.after;
	});
}

function copyCells(cells: readonly Cell[]): readonly Cell[] {
	return Object.freeze(cells.map((cell) => Object.freeze({ x: cell.x, y: cell.y })));
}

function copyPreparedEnvelope(prepared: PreparedEnvelope): PreparedEnvelope {
	return Object.freeze({
		valid: prepared.valid,
		failureCode: prepared.failureCode,
		reason: prepared.reason,
		conflictCells: copyCells(prepared.conflictCells),
		conflictCount: prepared.conflictCount,
		candidateCommittedEnvelopePairs: prepared.candidateCommittedEnvelopePairs,
		testedCommittedEnvelopePairs: prepared.testedCommittedEnvelopePairs,
		planningMilliseconds: prepared.planningMilliseconds,
		validationMilliseconds: prepared.validationMilliseconds,
		ticket: prepared.ticket ? copyPlacementTicket(prepared.ticket) : null,
	});
}

function copyPlacementPlanHeader(
	plan: StaticFabOrganizationBundlePlacementPlanHeader,
): StaticFabOrganizationBundlePlacementPlanHeader {
	return Object.freeze({
		kind: plan.kind,
		baseRevision: plan.baseRevision,
		basePatchSequence: plan.basePatchSequence,
		valid: plan.valid,
		reason: plan.reason,
		issueCode: plan.issueCode,
		conflicts: copyCells(plan.conflicts),
		newEdges: plan.newEdges,
		lengthMeters: plan.lengthMeters,
		turns: plan.turns,
		bend: plan.bend,
		nextOrganizationIdBefore: plan.nextOrganizationIdBefore,
		nextOrganizationIdAfter: plan.nextOrganizationIdAfter,
		nextRelationshipIdBefore: plan.nextRelationshipIdBefore,
		nextRelationshipIdAfter: plan.nextRelationshipIdAfter,
		organizationBundle: Object.freeze({
			collisionPolicy: plan.organizationBundle.collisionPolicy,
			anchor: Object.freeze({
				x: plan.organizationBundle.anchor.x,
				y: plan.organizationBundle.anchor.y,
			}),
			quarterTurns: plan.organizationBundle.quarterTurns,
			sourceModuleCount: plan.organizationBundle.sourceModuleCount,
			railEdgeCount: plan.organizationBundle.railEdgeCount,
			advancedSwitchCount: plan.organizationBundle.advancedSwitchCount,
			portCount: plan.organizationBundle.portCount,
			equipmentGroupCount: plan.organizationBundle.equipmentGroupCount,
			organizationCount: plan.organizationBundle.organizationCount,
			relationshipCount: plan.organizationBundle.relationshipCount,
			widthMeters: plan.organizationBundle.widthMeters,
			heightMeters: plan.organizationBundle.heightMeters,
			organizationNames: Object.freeze([...plan.organizationBundle.organizationNames]),
		}),
	});
}

/**
 * Own, hydrate and validate the single wire artifact behind caller-controlled checkpoints.
 * This returns an immutable exact-plan candidate, never a permit or document commit authority.
 */
export async function decodeStaticFabOrganizationBundlePlacementTransport(
	input: unknown,
	checkpoint: () => Promise<void>,
	operationBudget = 64,
): Promise<PreparedStaticFabOrganizationBundlePlacement> {
	if (!Number.isSafeInteger(operationBudget) || operationBudget <= 0)
		throw new Error("Placement decode operation budget must be positive.");
	if (
		!isRecord(input) ||
		input.version !== STATIC_FAB_ORGANIZATION_BUNDLE_PLACEMENT_TRANSPORT_VERSION
	)
		throw new Error("Unsupported placement transport version.");
	if (input.kind !== "compact" && input.kind !== "additions")
		throw new Error("Unknown placement transport kind.");
	const rawPrepared = input.prepared;
	assertValid(staticFabOrganizationBundlePlacementPreparedEnvelopeShapeError(rawPrepared));
	if (!isRecord(rawPrepared)) throw new Error("Placement transport envelope is missing.");
	if (input.kind === "compact") {
		if (rawPrepared.valid !== false)
			throw new Error("Compact placement transport cannot authorize additions.");
		assertValid(staticFabOrganizationBundlePlacementPreparedShapeError(rawPrepared));
		// Compact results contain only bounded diagnostics; encoding owns the same whitelisted fields.
		const compact = encodeStaticFabOrganizationBundlePlacementTransport(
			rawPrepared as unknown as PreparedStaticFabOrganizationBundlePlacement,
		);
		if (compact.kind !== "compact") throw new Error("Expected compact placement result.");
		await checkpoint();
		return compact.prepared;
	}
	if (rawPrepared.valid !== true) throw new Error("Addition transport must carry a valid plan.");
	assertValid(staticFabOrganizationBundlePlacementPlanHeaderShapeError(rawPrepared.plan, "full"));
	const rawHeader = rawPrepared.plan as StaticFabOrganizationBundlePlacementPlanHeader;
	if (!rawHeader.valid) throw new Error("Prepared and plan validity disagree.");
	assertValid(placementTicketShapeError(rawPrepared.ticket, rawHeader));
	const envelope = copyPreparedEnvelope(rawPrepared as unknown as PreparedEnvelope);
	const header = copyPlacementPlanHeader(rawHeader);
	const ticket = envelope.ticket;
	if (!ticket) throw new Error("Placement ticket is missing.");
	// Capture every column reference before the first await, including columns read by later hydrators.
	const capture = createStaticFabOrganizationBundlePlacementCapture(input.additions);
	const run = async <T>(task: CooperativeTask<T>): Promise<T> => {
		await checkpoint();
		while (!task.done) {
			task.step(operationBudget);
			await checkpoint();
		}
		return task.finish();
	};
	const additions = await run(capture);
	if (
		additions.portEquipment.nextPortId !== ticket.prospectiveNextPortId ||
		additions.portEquipment.nextEquipmentGroupId !== ticket.prospectiveNextEquipmentGroupId ||
		additions.organizations.nextOrganizationId !== header.nextOrganizationIdAfter ||
		additions.relationships.nextRelationshipId !== header.nextRelationshipIdAfter
	)
		throw new Error("Placement snapshot cursors do not match its ticket.");
	const equipment = await hydratePortEquipmentSnapshotCooperatively(
		additions.portEquipment,
		checkpoint,
		operationBudget,
	);
	const organizations = await run(
		createStaticFabOrganizationSnapshotHydrator(additions.organizations),
	);
	const relationships = await run(
		createStaticFabAssemblyRelationshipSnapshotHydrator(additions.relationships),
	);
	const plan = await run(
		createCooperativeTask(
			(function* (): Generator<void, StaticFabOrganizationBundlePlacementPlan> {
				const cells: Cell[] = [];
				const mutations: RailMutation[] = [];
				for (let index = 0; index < additions.xs.length; index++) {
					yield;
					const x = additions.xs[index] as number;
					const y = additions.ys[index] as number;
					cells.push(Object.freeze({ x, y }));
					mutations.push(
						Object.freeze({ x, y, before: 0, after: additions.encoded[index] as number }),
					);
				}
				const switches: AdvancedSwitchRecord[] = [];
				for (let index = 0; index < additions.switchIds.length; index++) {
					yield;
					switches.push(
						copyAdvancedSwitch(
							readAdvancedSwitchRecord(
								additions.switches,
								index,
								additions.switchIds[index] as number,
								"placement",
							),
						),
					);
				}
				return Object.freeze({
					...header,
					cells: Object.freeze(cells),
					mutations: Object.freeze(mutations),
					switchMutations: yield* additionMutationSteps(switches),
					portMutations: yield* additionMutationSteps(equipment.ports),
					equipmentGroupMutations: yield* additionMutationSteps(equipment.equipmentGroups),
					organizationMutations: yield* additionMutationSteps(organizations.records),
					relationshipMutations: yield* additionMutationSteps(relationships.records),
				});
			})(),
		),
	);
	const prepared = Object.freeze({ ...envelope, plan });
	assertValid(
		await run(
			createCooperativeTask(staticFabOrganizationBundlePlacementPreparedShapeErrorSteps(prepared)),
		),
	);
	const fingerprint = await run(
		createCooperativeTask(staticFabOrganizationBundlePlacementFingerprintSteps(plan)),
	);
	if (fingerprint !== ticket.planFingerprint)
		throw new Error("Placement transport fingerprint does not match its ticket.");
	await checkpoint();
	return prepared;
}

function* additionMutationSteps<R extends { readonly id: number }>(
	records: readonly R[],
): Generator<void, readonly Readonly<{ id: number; before: null; after: R }>[]> {
	const mutations: Readonly<{ id: number; before: null; after: R }>[] = [];
	for (const after of records) {
		yield;
		mutations.push(Object.freeze({ id: after.id, before: null, after }));
	}
	return Object.freeze(mutations);
}

function assertValid(error: string | null): void {
	if (error) throw new Error(`Invalid placement transport: ${error}.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function copyPlacementTicket(
	ticket: StaticFabOrganizationBundlePlacementWorkerTicket,
): StaticFabOrganizationBundlePlacementWorkerTicket {
	return Object.freeze({
		ticketId: ticket.ticketId,
		validationLevel: ticket.validationLevel,
		sourceRevision: ticket.sourceRevision,
		sourcePatchSequence: ticket.sourcePatchSequence,
		sourceChecksum: ticket.sourceChecksum,
		sourceNextAdvancedSwitchId: ticket.sourceNextAdvancedSwitchId,
		sourceNextPortId: ticket.sourceNextPortId,
		sourceNextEquipmentGroupId: ticket.sourceNextEquipmentGroupId,
		sourceNextOrganizationId: ticket.sourceNextOrganizationId,
		sourceNextRelationshipId: ticket.sourceNextRelationshipId,
		bundleFingerprint: ticket.bundleFingerprint,
		anchor: Object.freeze({ x: ticket.anchor.x, y: ticket.anchor.y }),
		quarterTurns: ticket.quarterTurns,
		planFingerprint: ticket.planFingerprint,
		prospectiveChecksum: ticket.prospectiveChecksum,
		prospectiveNextAdvancedSwitchId: ticket.prospectiveNextAdvancedSwitchId,
		prospectiveNextPortId: ticket.prospectiveNextPortId,
		prospectiveNextEquipmentGroupId: ticket.prospectiveNextEquipmentGroupId,
		prospectiveNextOrganizationId: ticket.prospectiveNextOrganizationId,
		prospectiveNextRelationshipId: ticket.prospectiveNextRelationshipId,
	});
}
