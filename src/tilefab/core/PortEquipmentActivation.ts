import { isCanonicalPortEquipmentState, type PortEquipmentState } from "./EquipmentGroup";
import {
	captureLegacyCustomEquipmentBaselineCooperatively,
	type LegacyCustomEquipmentBaseline,
} from "./LegacyCustomEquipment";
import { assertPortEquipmentLayoutCooperatively } from "./PortEquipmentLayoutValidator";
import type { TileMap } from "./TileMap";

const PORT_EQUIPMENT_ACTIVATION = Symbol("PortEquipmentActivation");

/** Runtime proof that one exact immutable port/equipment generation passed cooperative validation. */
export interface ValidatedPortEquipmentActivation {
	readonly [PORT_EQUIPMENT_ACTIVATION]: true;
}

interface PortEquipmentActivationBinding {
	readonly map: TileMap;
	readonly mapRevision: number;
	readonly mapMutationGeneration: number;
	readonly state: PortEquipmentState;
	readonly legacyCustomEquipment: LegacyCustomEquipmentBaseline;
}

const activationBindings = new WeakMap<object, PortEquipmentActivationBinding>();

/**
 * Validate and prepare one exact immutable port/equipment generation for direct document adoption.
 *
 * The returned token exposes neither records nor the legacy baseline. Its WeakMap binding prevents a
 * structurally similar state, a cloned map, or a later map revision from reusing this proof.
 */
export async function validatePortEquipmentActivation(
	map: TileMap,
	state: PortEquipmentState,
	checkpoint: () => Promise<void>,
	operationBudget = 128,
): Promise<ValidatedPortEquipmentActivation> {
	if (!Number.isSafeInteger(operationBudget) || operationBudget <= 0) {
		throw new RangeError("Port equipment activation operation budget must be positive.");
	}
	if (!isCanonicalPortEquipmentState(state)) {
		throw new Error("Port equipment activation requires a canonical immutable state generation.");
	}
	const mapRevision = map.getRevision();
	const mapMutationGeneration = map.getMutationGeneration();
	const checkedCheckpoint = async (): Promise<void> => {
		await checkpoint();
		assertStableMapRevision(map, mapRevision, mapMutationGeneration);
	};
	await assertFrozenPortEquipmentGeneration(state, checkedCheckpoint, operationBudget);
	await assertPortEquipmentLayoutCooperatively(map, state, checkedCheckpoint, operationBudget);
	const legacyCustomEquipment = await captureLegacyCustomEquipmentBaselineCooperatively(
		state,
		checkedCheckpoint,
		operationBudget,
	);
	assertStableMapRevision(map, mapRevision, mapMutationGeneration);

	const activation = Object.freeze(Object.create(null) as ValidatedPortEquipmentActivation);
	activationBindings.set(
		activation,
		Object.freeze({
			map,
			mapRevision,
			mapMutationGeneration,
			state,
			legacyCustomEquipment,
		}),
	);
	return activation;
}

/** Return true only for the exact runtime objects and authored map revision that were validated. */
export function portEquipmentActivationMatches(
	activation: unknown,
	map: TileMap,
	state: PortEquipmentState,
): activation is ValidatedPortEquipmentActivation {
	if ((typeof activation !== "object" && typeof activation !== "function") || activation === null) {
		return false;
	}
	const binding = activationBindings.get(activation);
	return (
		binding !== undefined &&
		binding.map === map &&
		binding.mapRevision === map.getRevision() &&
		binding.mapMutationGeneration === map.getMutationGeneration() &&
		binding.state === state
	);
}

/** Reject a missing, forged, stale, or generation-mismatched activation proof. */
export function assertPortEquipmentActivation(
	activation: unknown,
	map: TileMap,
	state: PortEquipmentState,
): asserts activation is ValidatedPortEquipmentActivation {
	if (!portEquipmentActivationMatches(activation, map, state)) {
		throw new Error("Port equipment activation does not match the current document generation.");
	}
}

/**
 * Return the cooperatively captured legacy baseline after asserting the exact activation binding.
 * RailDocument keeps this value private and publishes only the already-frozen authored state.
 */
export function legacyCustomEquipmentBaselineForPortEquipmentActivation(
	activation: unknown,
	map: TileMap,
	state: PortEquipmentState,
): LegacyCustomEquipmentBaseline {
	assertPortEquipmentActivation(activation, map, state);
	return (activationBindings.get(activation) as PortEquipmentActivationBinding)
		.legacyCustomEquipment;
}

async function assertFrozenPortEquipmentGeneration(
	state: PortEquipmentState,
	checkpoint: () => Promise<void>,
	operationBudget: number,
): Promise<void> {
	if (
		!Object.isFrozen(state) ||
		!Object.isFrozen(state.ports) ||
		!Object.isFrozen(state.equipmentGroups)
	) {
		throw new Error("Port equipment activation requires an immutable state generation.");
	}
	let operations = 0;
	const consumeOperation = async (): Promise<void> => {
		operations++;
		if (operations < operationBudget) return;
		operations = 0;
		await checkpoint();
	};
	for (const port of state.ports) {
		if (!Object.isFrozen(port) || !Object.isFrozen(port.route)) {
			throw new Error(`Port equipment activation requires immutable port ${port.id}.`);
		}
		await consumeOperation();
	}
	for (const group of state.equipmentGroups) {
		if (!Object.isFrozen(group) || !Object.isFrozen(group.portIds)) {
			throw new Error(`Port equipment activation requires immutable equipment group ${group.id}.`);
		}
		await consumeOperation();
	}
	await checkpoint();
}

function assertStableMapRevision(
	map: TileMap,
	expectedRevision: number,
	expectedMutationGeneration: number,
): void {
	if (
		map.getRevision() !== expectedRevision ||
		map.getMutationGeneration() !== expectedMutationGeneration
	) {
		throw new Error("Port equipment activation map changed during cooperative validation.");
	}
}
