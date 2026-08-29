import type { EquipmentGroupMutation } from "./EquipmentGroup";
import type { PortMutation } from "./PortRecord";

const immutablePlanGraphs = new WeakSet<object>();

/** Ordinary all-or-nothing placement for more than one physical equipment kind. */
export const PORT_EQUIPMENT_BATCH_PLAN_KIND = "place-port-equipment-batch" as const;

export const PORT_EQUIPMENT_PLAN_KINDS = Object.freeze([
	"place-ohb",
	"place-eq",
	"place-stk",
	PORT_EQUIPMENT_BATCH_PLAN_KIND,
	"edit-port-equipment",
	"erase-port-equipment",
] as const);

export type PortEquipmentPlanKind =
	| "place-ohb"
	| "place-eq"
	| "place-stk"
	| typeof PORT_EQUIPMENT_BATCH_PLAN_KIND
	| "edit-port-equipment"
	| "erase-port-equipment";

export interface PortEquipmentMutationPlan {
	readonly kind: PortEquipmentPlanKind;
	readonly valid: boolean;
	readonly reason: string;
	readonly baseRevision: number;
	readonly basePatchSequence: number;
	readonly portMutations: readonly PortMutation[];
	readonly equipmentGroupMutations: readonly EquipmentGroupMutation[];
}

export function createPortEquipmentMutationPlan(
	kind: PortEquipmentPlanKind,
	baseRevision: number,
	basePatchSequence: number,
	portMutations: readonly PortMutation[],
	equipmentGroupMutations: readonly EquipmentGroupMutation[],
): PortEquipmentMutationPlan {
	const plan = Object.freeze({
		kind,
		valid: portMutations.length > 0 || equipmentGroupMutations.length > 0,
		reason:
			portMutations.length > 0 || equipmentGroupMutations.length > 0
				? "Port/equipment mutations are structurally ready for document validation."
				: "A port/equipment plan must contain at least one mutation.",
		baseRevision,
		basePatchSequence,
		portMutations: Object.freeze([...portMutations]),
		equipmentGroupMutations: Object.freeze([...equipmentGroupMutations]),
	});
	return plan;
}

/**
 * Worker-side variant for cooperative encoders that must keep reading the graph after yielding.
 * The factory clones and freezes the outer arrays; every supplied nested node must already be
 * recursively frozen own-data. This certificate grants immutability only; it grants no review or
 * document authority.
 */
export function createPortEquipmentMutationPlanWithImmutableGraphCertificate(
	kind: PortEquipmentPlanKind,
	baseRevision: number,
	basePatchSequence: number,
	portMutations: readonly PortMutation[],
	equipmentGroupMutations: readonly EquipmentGroupMutation[],
): PortEquipmentMutationPlan {
	const plan = createPortEquipmentMutationPlan(
		kind,
		baseRevision,
		basePatchSequence,
		portMutations,
		equipmentGroupMutations,
	);
	if (!certifyImmutablePlanGraph(plan)) {
		throw new TypeError("Port/equipment plan graph must be recursively immutable own-data.");
	}
	return plan;
}

/**
 * Large-plan variant that validates each supplied immutable mutation graph before publishing one
 * clean owned outer array. The certificate is identical to the synchronous factory's certificate.
 */
export async function createPortEquipmentMutationPlanWithImmutableGraphCertificateCooperatively(
	kind: PortEquipmentPlanKind,
	baseRevision: number,
	basePatchSequence: number,
	portMutations: readonly PortMutation[],
	equipmentGroupMutations: readonly EquipmentGroupMutation[],
	checkpoint: () => Promise<void>,
	operationBudget = 128,
): Promise<PortEquipmentMutationPlan> {
	if (!Number.isSafeInteger(operationBudget) || operationBudget <= 0) {
		throw new RangeError("Plan graph certificate operation budget must be positive.");
	}
	const visited = new WeakSet<object>();
	let operations = 0;
	const consumeOperation = async (): Promise<void> => {
		operations++;
		if (operations < operationBudget) return;
		operations = 0;
		await checkpoint();
	};
	const ownedPortMutations: PortMutation[] = [];
	for (const mutation of portMutations) {
		if (!isRecursivelyFrozenOwnDataGraph(mutation, visited)) {
			throw new TypeError("Port/equipment plan graph must be recursively immutable own-data.");
		}
		ownedPortMutations.push(mutation);
		await consumeOperation();
	}
	const ownedEquipmentGroupMutations: EquipmentGroupMutation[] = [];
	for (const mutation of equipmentGroupMutations) {
		if (!isRecursivelyFrozenOwnDataGraph(mutation, visited)) {
			throw new TypeError("Port/equipment plan graph must be recursively immutable own-data.");
		}
		ownedEquipmentGroupMutations.push(mutation);
		await consumeOperation();
	}
	const hasChanges = ownedPortMutations.length > 0 || ownedEquipmentGroupMutations.length > 0;
	const plan = Object.freeze({
		kind,
		valid: hasChanges,
		reason: hasChanges
			? "Port/equipment mutations are structurally ready for document validation."
			: "A port/equipment plan must contain at least one mutation.",
		baseRevision,
		basePatchSequence,
		portMutations: Object.freeze(ownedPortMutations),
		equipmentGroupMutations: Object.freeze(ownedEquipmentGroupMutations),
	});
	immutablePlanGraphs.add(plan);
	await checkpoint();
	return plan;
}

export function createInvalidPortEquipmentMutationPlan(
	kind: PortEquipmentPlanKind,
	baseRevision: number,
	basePatchSequence: number,
	reason: string,
): PortEquipmentMutationPlan {
	const plan = Object.freeze({
		kind,
		valid: false,
		reason,
		baseRevision,
		basePatchSequence,
		portMutations: Object.freeze([]),
		equipmentGroupMutations: Object.freeze([]),
	});
	return plan;
}

/**
 * O(1) evidence that this exact plan identity was created over a recursively frozen own-data graph.
 *
 * Cooperative consumers use this certificate before yielding while they still read the source
 * graph. It is an immutability certificate only; it grants no document or review authority.
 */
export function isCertifiedImmutablePortEquipmentMutationPlanGraph(
	plan: PortEquipmentMutationPlan,
): boolean {
	return immutablePlanGraphs.has(plan);
}

/** Keep a command label from widening the mutation semantics that label authorizes. */
export function portEquipmentPlanKindError(plan: PortEquipmentMutationPlan): string | null {
	if (!PORT_EQUIPMENT_PLAN_KINDS.includes(plan.kind)) {
		return "Port/equipment plan kind is invalid.";
	}
	const additionsOnly =
		plan.portMutations.every((mutation) => mutation.before === null && mutation.after !== null) &&
		plan.equipmentGroupMutations.every(
			(mutation) => mutation.before === null && mutation.after !== null,
		);
	if (
		plan.kind === "place-ohb" ||
		plan.kind === "place-eq" ||
		plan.kind === "place-stk" ||
		plan.kind === PORT_EQUIPMENT_BATCH_PLAN_KIND
	) {
		if (!additionsOnly) return "Placement plans may only add reciprocal port/equipment records.";
		if (plan.kind === PORT_EQUIPMENT_BATCH_PLAN_KIND) {
			const kinds = new Set(plan.equipmentGroupMutations.map((mutation) => mutation.after?.kind));
			return kinds.size >= 2 ? null : "Batch placement must contain more than one equipment kind.";
		}
		const expectedKind =
			plan.kind === "place-ohb" ? "OHB" : plan.kind === "place-eq" ? "EQ" : "STK";
		if (
			plan.portMutations.some((mutation) => mutation.after?.portType !== expectedKind) ||
			plan.equipmentGroupMutations.some((mutation) => mutation.after?.kind !== expectedKind)
		) {
			return "Single-kind placement contains another equipment kind.";
		}
		return null;
	}
	if (plan.kind === "erase-port-equipment") {
		return plan.portMutations.every(
			(mutation) => mutation.before !== null && mutation.after === null,
		) &&
			plan.equipmentGroupMutations.every(
				(mutation) => mutation.before !== null && mutation.after === null,
			)
			? null
			: "Erase plans may only remove reciprocal port/equipment records.";
	}
	if (
		plan.equipmentGroupMutations.some(
			(mutation) => mutation.before === null || mutation.after === null,
		)
	) {
		return "Edit plans may only update existing equipment groups.";
	}
	return null;
}

/** Same command-label guard for certified immutable plans read across cooperative checkpoints. */
export async function portEquipmentPlanKindErrorCooperatively(
	plan: PortEquipmentMutationPlan,
	checkpoint: () => Promise<void>,
	operationBudget = 128,
): Promise<string | null> {
	if (!Number.isSafeInteger(operationBudget) || operationBudget <= 0) {
		throw new RangeError("Plan kind validation operation budget must be positive.");
	}
	if (!isCertifiedImmutablePortEquipmentMutationPlanGraph(plan)) {
		return "Cooperative port/equipment plan validation requires an immutable plan graph.";
	}
	if (!PORT_EQUIPMENT_PLAN_KINDS.includes(plan.kind)) {
		return "Port/equipment plan kind is invalid.";
	}
	let operations = 0;
	const consumeOperation = async (): Promise<void> => {
		operations++;
		if (operations < operationBudget) return;
		operations = 0;
		await checkpoint();
	};
	const placement =
		plan.kind === "place-ohb" ||
		plan.kind === "place-eq" ||
		plan.kind === "place-stk" ||
		plan.kind === PORT_EQUIPMENT_BATCH_PLAN_KIND;
	if (placement) {
		for (const mutation of plan.portMutations) {
			if (mutation.before !== null || mutation.after === null) {
				return "Placement plans may only add reciprocal port/equipment records.";
			}
			await consumeOperation();
		}
		const kinds = new Set<string>();
		for (const mutation of plan.equipmentGroupMutations) {
			if (mutation.before !== null || mutation.after === null) {
				return "Placement plans may only add reciprocal port/equipment records.";
			}
			kinds.add(mutation.after.kind);
			await consumeOperation();
		}
		if (plan.kind === PORT_EQUIPMENT_BATCH_PLAN_KIND) {
			return kinds.size >= 2 ? null : "Batch placement must contain more than one equipment kind.";
		}
		const expectedKind =
			plan.kind === "place-ohb" ? "OHB" : plan.kind === "place-eq" ? "EQ" : "STK";
		for (const mutation of plan.portMutations) {
			if (mutation.after?.portType !== expectedKind) {
				return "Single-kind placement contains another equipment kind.";
			}
			await consumeOperation();
		}
		for (const mutation of plan.equipmentGroupMutations) {
			if (mutation.after?.kind !== expectedKind) {
				return "Single-kind placement contains another equipment kind.";
			}
			await consumeOperation();
		}
		return null;
	}
	if (plan.kind === "erase-port-equipment") {
		for (const mutation of plan.portMutations) {
			if (mutation.before === null || mutation.after !== null) {
				return "Erase plans may only remove reciprocal port/equipment records.";
			}
			await consumeOperation();
		}
		for (const mutation of plan.equipmentGroupMutations) {
			if (mutation.before === null || mutation.after !== null) {
				return "Erase plans may only remove reciprocal port/equipment records.";
			}
			await consumeOperation();
		}
		return null;
	}
	for (const mutation of plan.equipmentGroupMutations) {
		if (mutation.before === null || mutation.after === null) {
			return "Edit plans may only update existing equipment groups.";
		}
		await consumeOperation();
	}
	return null;
}

function certifyImmutablePlanGraph(plan: PortEquipmentMutationPlan): boolean {
	try {
		if (isRecursivelyFrozenOwnDataGraph(plan, new WeakSet<object>())) {
			immutablePlanGraphs.add(plan);
			return true;
		}
	} catch {
		// A hostile or exotic nested graph is still a plan value, but never receives the certificate.
	}
	return false;
}

function isRecursivelyFrozenOwnDataGraph(value: unknown, visited: WeakSet<object>): boolean {
	if (value === null || (typeof value !== "object" && typeof value !== "function")) return true;
	if (typeof value === "function" || !Object.isFrozen(value)) return false;
	const objectValue = value as object;
	if (visited.has(objectValue)) return true;
	visited.add(objectValue);
	const prototype = Object.getPrototypeOf(objectValue);
	if (prototype !== Object.prototype && prototype !== Array.prototype && prototype !== null) {
		return false;
	}
	for (const key of Reflect.ownKeys(objectValue)) {
		if (typeof key !== "string") return false;
		const descriptor = Object.getOwnPropertyDescriptor(objectValue, key);
		if (
			descriptor === undefined ||
			!("value" in descriptor) ||
			descriptor.configurable ||
			descriptor.writable ||
			!isRecursivelyFrozenOwnDataGraph(descriptor.value, visited)
		) {
			return false;
		}
	}
	return true;
}
