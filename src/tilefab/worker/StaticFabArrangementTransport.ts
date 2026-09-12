import { copyAdvancedSwitch } from "../core/AdvancedSwitch";
import {
	type CooperativeTask,
	completeCooperativeSteps,
	createCooperativeTask,
} from "../core/CooperativeTask";
import type { StaticFabArrangementPlan } from "../core/StaticFabArrangementPlan";
import {
	createAdvancedSwitchRecordFields,
	readAdvancedSwitchRecord,
	writeAdvancedSwitchRecord,
} from "./AdvancedSwitchSoA";
import { encodePortEquipmentPatch, readPortRecordFields } from "./PortEquipmentSoA";
import {
	createStaticFabArrangementColumnCapture,
	type StaticFabArrangementColumns,
} from "./StaticFabArrangementColumnCapture";
import type { PreparedStaticFabArrangement } from "./StaticFabArrangementProtocol";
import { staticFabArrangementPreparedShapeErrorSteps } from "./StaticFabArrangementResponseValidator";
import {
	type ArrangementEnvelope,
	type ArrangementPlanHeader,
	assertArrangementTicket,
	assertArrangementTransport,
	ownArrangementCells,
	ownArrangementEnvelope,
	ownArrangementHeader,
} from "./StaticFabArrangementTransportHeader";
import {
	createStaticFabAssemblyRelationshipSnapshotHydrator,
	encodeStaticFabAssemblyRelationshipPatch,
	STATIC_FAB_ASSEMBLY_RELATIONSHIP_SNAPSHOT_SCHEMA_VERSION,
} from "./StaticFabAssemblyRelationshipSoA";
import {
	createStaticFabOrganizationSnapshotHydrator,
	encodeStaticFabOrganizationPatch,
	STATIC_FAB_ORGANIZATION_SNAPSHOT_SCHEMA_VERSION,
} from "./StaticFabOrganizationSoA";
import { transferDataObject as object } from "./TransferColumnCapture";

export const STATIC_FAB_ARRANGEMENT_TRANSPORT_VERSION = 1 as const;
export type StaticFabArrangementTransport =
	| Readonly<{
			version: typeof STATIC_FAB_ARRANGEMENT_TRANSPORT_VERSION;
			kind: "compact";
			prepared: PreparedStaticFabArrangement;
	  }>
	| Readonly<{
			version: typeof STATIC_FAB_ARRANGEMENT_TRANSPORT_VERSION;
			kind: "movement";
			prepared: ArrangementEnvelope & { readonly plan: ArrangementPlanHeader };
			columns: StaticFabArrangementColumns;
	  }>;

/** Worker-only encoding: source records stay intact when these owned columns are transferred. */
export function encodeStaticFabArrangementTransport(
	prepared: PreparedStaticFabArrangement,
): StaticFabArrangementTransport {
	assertArrangementTransport(
		completeCooperativeSteps(staticFabArrangementPreparedShapeErrorSteps(prepared)),
	);
	const envelope = ownArrangementEnvelope(prepared);
	if (!prepared.valid)
		return Object.freeze({
			version: STATIC_FAB_ARRANGEMENT_TRANSPORT_VERSION,
			kind: "compact",
			prepared: ownCompact(prepared, envelope),
		});
	const plan = prepared.plan;
	if (!plan) throw new Error("Movement transport requires a plan.");
	const switches = {
		ids: Int32Array.from(plan.switchMutations, (m) => m.id),
		before: createAdvancedSwitchRecordFields(plan.switchMutations.length),
		after: createAdvancedSwitchRecordFields(plan.switchMutations.length),
	};
	for (let i = 0; i < plan.switchMutations.length; i++) {
		const change = plan.switchMutations[i];
		if (!change?.before || !change.after)
			throw new Error("Arrangement requires existing switch records.");
		writeAdvancedSwitchRecord(switches.before, i, change.before);
		writeAdvancedSwitchRecord(switches.after, i, change.after);
	}
	const ports = encodePortEquipmentPatch(plan.portMutations, []).fields;
	const organizations = encodeStaticFabOrganizationPatch(
		plan.organizationMutations,
		plan.nextOrganizationIdBefore,
		plan.nextOrganizationIdAfter,
	).fields;
	const relationships = encodeStaticFabAssemblyRelationshipPatch(
		plan.relationshipMutations,
		plan.nextRelationshipIdBefore,
		plan.nextRelationshipIdAfter,
	).fields;
	return Object.freeze({
		version: STATIC_FAB_ARRANGEMENT_TRANSPORT_VERSION,
		kind: "movement",
		prepared: Object.freeze({ ...envelope, plan: ownArrangementHeader(plan, true) }),
		columns: Object.freeze({
			cells: Object.freeze({
				xs: Int32Array.from(plan.cells, (c) => c.x),
				ys: Int32Array.from(plan.cells, (c) => c.y),
			}),
			rail: Object.freeze({
				xs: Int32Array.from(plan.mutations, (m) => m.x),
				ys: Int32Array.from(plan.mutations, (m) => m.y),
				before: Uint8Array.from(plan.mutations, (m) => m.before),
				after: Uint8Array.from(plan.mutations, (m) => m.after),
			}),
			switches: Object.freeze(switches),
			ports: Object.freeze({
				ids: ports.portIds,
				before: ports.portBefore,
				after: ports.portAfter,
			}),
			organizations: Object.freeze({
				ids: organizations.organizationIds,
				before: organizations.before,
				after: organizations.after,
			}),
			relationships: Object.freeze({
				ids: relationships.relationshipIds,
				before: relationships.before,
				after: relationships.after,
			}),
		}),
	});
}

/** Returns an owned exact-plan candidate only; live source/checksum and one-shot adoption still follow. */
export async function decodeStaticFabArrangementTransport(
	input: unknown,
	checkpoint: () => Promise<void>,
	operationBudget = 64,
): Promise<PreparedStaticFabArrangement> {
	if (!Number.isSafeInteger(operationBudget) || operationBudget <= 0)
		throw new Error("Arrangement decode budget must be positive.");
	const wire = object(input, "arrangement transport", ["version", "kind", "prepared"]);
	if (wire.version !== STATIC_FAB_ARRANGEMENT_TRANSPORT_VERSION)
		throw new Error("Unsupported arrangement transport version.");
	if (wire.kind !== "compact" && wire.kind !== "movement")
		throw new Error("Unknown arrangement transport kind.");
	const raw = object(wire.prepared, "arrangement prepared", ["plan"]);
	const envelope = ownArrangementEnvelope(raw);
	if (wire.kind === "compact") {
		if (envelope.valid) throw new Error("Compact arrangement cannot authorize movement.");
		const prepared = ownCompact(raw, envelope);
		assertArrangementTransport(
			completeCooperativeSteps(staticFabArrangementPreparedShapeErrorSteps(prepared)),
		);
		await checkpoint();
		return prepared;
	}
	if (!envelope.valid) throw new Error("Movement arrangement requires a valid envelope.");
	const header = ownArrangementHeader(raw.plan, true);
	assertArrangementTicket(envelope, header);
	const capture = createStaticFabArrangementColumnCapture(
		object(wire, "arrangement transport", ["columns"]).columns,
	);
	const run = async <T>(task: CooperativeTask<T>): Promise<T> => {
		await checkpoint();
		while (!task.done) {
			task.step(operationBudget);
			await checkpoint();
		}
		return task.finish();
	};
	// Every response reference above is captured before the first await; all hydration below uses owned columns.
	const columns = await run(capture);
	const hydrateOrganizations = (side: "before" | "after") =>
		run(
			createStaticFabOrganizationSnapshotHydrator({
				schemaVersion: STATIC_FAB_ORGANIZATION_SNAPSHOT_SCHEMA_VERSION,
				nextOrganizationId: header.nextOrganizationIdBefore,
				organizationIds: columns.organizations.ids,
				records: columns.organizations[side],
			}),
		);
	const hydrateRelationships = (side: "before" | "after") =>
		run(
			createStaticFabAssemblyRelationshipSnapshotHydrator({
				schemaVersion: STATIC_FAB_ASSEMBLY_RELATIONSHIP_SNAPSHOT_SCHEMA_VERSION,
				nextRelationshipId: header.nextRelationshipIdBefore,
				relationshipIds: columns.relationships.ids,
				records: columns.relationships[side],
			}),
		);
	const organizationBefore = await hydrateOrganizations("before");
	const organizationAfter = await hydrateOrganizations("after");
	const relationshipBefore = await hydrateRelationships("before");
	const relationshipAfter = await hydrateRelationships("after");
	const plan = await run(
		createCooperativeTask(
			(function* (): Generator<void, StaticFabArrangementPlan> {
				const cells: StaticFabArrangementPlan["cells"][number][] = [];
				for (let i = 0; i < columns.cells.xs.length; i++) {
					yield;
					cells.push(
						Object.freeze({ x: columns.cells.xs[i] as number, y: columns.cells.ys[i] as number }),
					);
				}
				const mutations: StaticFabArrangementPlan["mutations"][number][] = [];
				for (let i = 0; i < columns.rail.xs.length; i++) {
					yield;
					mutations.push(
						Object.freeze({
							x: columns.rail.xs[i] as number,
							y: columns.rail.ys[i] as number,
							before: columns.rail.before[i] as number,
							after: columns.rail.after[i] as number,
						}),
					);
				}
				const switchMutations: StaticFabArrangementPlan["switchMutations"][number][] = [];
				for (let i = 0; i < columns.switches.ids.length; i++) {
					yield;
					const id = columns.switches.ids[i] as number;
					switchMutations.push(
						Object.freeze({
							id,
							before: copyAdvancedSwitch(
								readAdvancedSwitchRecord(columns.switches.before, i, id, "arrangement"),
							),
							after: copyAdvancedSwitch(
								readAdvancedSwitchRecord(columns.switches.after, i, id, "arrangement"),
							),
						}),
					);
				}
				const portMutations: StaticFabArrangementPlan["portMutations"][number][] = [];
				for (let i = 0; i < columns.ports.ids.length; i++) {
					yield;
					const id = columns.ports.ids[i] as number;
					portMutations.push(
						Object.freeze({
							id,
							before: readPortRecordFields(id, columns.ports.before, i),
							after: readPortRecordFields(id, columns.ports.after, i),
						}),
					);
				}
				return Object.freeze({
					...header,
					cells: Object.freeze(cells),
					mutations: Object.freeze(mutations),
					switchMutations: Object.freeze(switchMutations),
					portMutations: Object.freeze(portMutations),
					equipmentGroupMutations: Object.freeze([]),
					organizationMutations: yield* pairs(
						organizationBefore.records,
						organizationAfter.records,
					),
					relationshipMutations: yield* pairs(
						relationshipBefore.records,
						relationshipAfter.records,
					),
				});
			})(),
		),
	);
	const prepared = Object.freeze({ ...envelope, plan });
	// This includes two-sided budgets, allowed translations, IDs/cursors and the exact existing plan fingerprint.
	assertArrangementTransport(
		await run(createCooperativeTask(staticFabArrangementPreparedShapeErrorSteps(prepared))),
	);
	await checkpoint();
	return prepared;
}

function* pairs<R extends { readonly id: number }>(
	before: readonly R[],
	after: readonly R[],
): Generator<void, readonly Readonly<{ id: number; before: R; after: R }>[]> {
	if (before.length !== after.length) throw new Error("Arrangement record counts disagree.");
	const result: Readonly<{ id: number; before: R; after: R }>[] = [];
	for (let i = 0; i < before.length; i++) {
		yield;
		const first = before[i];
		const second = after[i];
		if (!first || !second || first.id !== second.id)
			throw new Error("Arrangement record IDs disagree.");
		result.push(Object.freeze({ id: first.id, before: first, after: second }));
	}
	return Object.freeze(result);
}

function ownCompact(input: unknown, envelope: ArrangementEnvelope): PreparedStaticFabArrangement {
	const raw = object(input, "compact arrangement", ["plan"]);
	if (raw.plan === null) return Object.freeze({ ...envelope, plan: null });
	const keys = [
		"mutations",
		"switchMutations",
		"portMutations",
		"equipmentGroupMutations",
		"organizationMutations",
		"relationshipMutations",
	] as const;
	const plan = object(raw.plan, "compact arrangement plan", ["cells", ...keys]);
	for (const key of keys)
		if (!Array.isArray(plan[key]) || plan[key].length !== 0)
			throw new Error("Compact arrangement cannot contain mutations.");
	return Object.freeze({
		...envelope,
		plan: Object.freeze({
			...ownArrangementHeader(plan, false),
			cells: ownArrangementCells(plan.cells),
			mutations: Object.freeze([]),
			switchMutations: Object.freeze([]),
			portMutations: Object.freeze([]),
			equipmentGroupMutations: Object.freeze([]),
			organizationMutations: Object.freeze([]),
			relationshipMutations: Object.freeze([]),
		}),
	});
}
