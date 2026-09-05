import { createCooperativeTask } from "./CooperativeTask";
import type { PortEquipmentState } from "./EquipmentGroup";
import {
	createRailModuleOwnershipIndexCompiler,
	type RailModuleOwnershipIndex,
	railModuleOwnershipIndexMatchesMap,
} from "./RailModuleOwnership";
import {
	type StaticFabAssemblyRelationshipStateV1,
	validateStaticFabAssemblyRelationshipSourceSteps,
} from "./StaticFabAssemblyRelationship";
import type { StaticFabOrganizationState } from "./StaticFabOrganization";
import {
	assertStaticFabOrganizationActivation,
	type ValidatedStaticFabOrganizationActivation,
	validateStaticFabOrganizationActivation,
} from "./StaticFabOrganizationActivation";
import type { TileMap } from "./TileMap";

const RELATIONSHIP_ACTIVATION = Symbol("StaticFabAssemblyRelationshipActivation");

/** Opaque evidence for complete relationship semantics on one exact authored generation. */
export interface ValidatedStaticFabAssemblyRelationshipActivation {
	readonly [RELATIONSHIP_ACTIVATION]: true;
}

interface RelationshipActivationBinding {
	readonly map: TileMap;
	readonly revision: number;
	readonly mutationGeneration: number;
	readonly portEquipment: PortEquipmentState;
	readonly organizations: StaticFabOrganizationState;
	readonly relationships: StaticFabAssemblyRelationshipStateV1;
}

const activations = new WeakMap<object, RelationshipActivationBinding>();

/** Complete independently reconstructed prerequisites for one exact authored generation. */
export interface ValidatedStaticFabAssemblyRelationshipSourceActivation {
	readonly ownership: RailModuleOwnershipIndex;
	readonly organizationActivation: ValidatedStaticFabOrganizationActivation;
	readonly relationshipActivation: ValidatedStaticFabAssemblyRelationshipActivation;
}

/** Derive ownership from authored cells, never from transferred Worker ownership claims. */
export async function validateStaticFabAssemblyRelationshipSourceActivation(
	map: TileMap,
	portEquipment: PortEquipmentState,
	organizations: StaticFabOrganizationState,
	relationships: StaticFabAssemblyRelationshipStateV1,
	checkpoint: () => Promise<void>,
	operationBudget = 128,
): Promise<ValidatedStaticFabAssemblyRelationshipSourceActivation> {
	if (!Number.isSafeInteger(operationBudget) || operationBudget <= 0) {
		throw new Error(
			"Relationship source activation operation budget must be a positive safe integer.",
		);
	}
	const compiler = createRailModuleOwnershipIndexCompiler(map);
	while (!compiler.done) {
		compiler.step(operationBudget);
		await checkpoint();
	}
	const ownership = compiler.finish();
	const organizationActivation = await validateStaticFabOrganizationActivation(
		map,
		portEquipment,
		organizations,
		ownership,
		checkpoint,
		operationBudget,
	);
	const relationshipActivation = await validateStaticFabAssemblyRelationshipActivation(
		map,
		portEquipment,
		organizations,
		relationships,
		ownership,
		organizationActivation,
		checkpoint,
		operationBudget,
	);
	return Object.freeze({ ownership, organizationActivation, relationshipActivation });
}

/** Reuse the already validated organization and ownership generations; never compile them again. */
export async function validateStaticFabAssemblyRelationshipActivation(
	map: TileMap,
	portEquipment: PortEquipmentState,
	organizations: StaticFabOrganizationState,
	relationships: StaticFabAssemblyRelationshipStateV1,
	ownership: RailModuleOwnershipIndex,
	organizationActivation: ValidatedStaticFabOrganizationActivation,
	checkpoint: () => Promise<void>,
	operationBudget = 128,
): Promise<ValidatedStaticFabAssemblyRelationshipActivation> {
	if (!Number.isSafeInteger(operationBudget) || operationBudget <= 0) {
		throw new Error("Relationship activation operation budget must be a positive safe integer.");
	}
	const revision = map.getRevision();
	const mutationGeneration = map.getMutationGeneration();
	const assertStableSource = (): void => {
		assertStaticFabOrganizationActivation(
			organizationActivation,
			map,
			portEquipment,
			organizations,
		);
		if (
			map.getRevision() !== revision ||
			map.getMutationGeneration() !== mutationGeneration ||
			!railModuleOwnershipIndexMatchesMap(ownership, map)
		) {
			throw new Error("조립 관계 활성화 중 authored source generation이 변경되었습니다");
		}
	};
	assertStableSource();
	const task = createCooperativeTask(
		validateStaticFabAssemblyRelationshipSourceSteps(
			map,
			portEquipment,
			organizations,
			relationships,
			ownership,
			organizationActivation,
		),
	);
	while (!task.done) {
		task.step(operationBudget);
		await checkpoint();
		assertStableSource();
	}
	const error = task.finish();
	if (error) throw new Error(error);
	const activation = Object.freeze(
		Object.create(null) as ValidatedStaticFabAssemblyRelationshipActivation,
	);
	activations.set(
		activation,
		Object.freeze({
			map,
			revision,
			mutationGeneration,
			portEquipment,
			organizations,
			relationships,
		}),
	);
	return activation;
}

export function staticFabAssemblyRelationshipActivationMatches(
	activation: unknown,
	map: TileMap,
	portEquipment: PortEquipmentState,
	organizations: StaticFabOrganizationState,
	relationships: StaticFabAssemblyRelationshipStateV1,
): activation is ValidatedStaticFabAssemblyRelationshipActivation {
	if (activation === null || typeof activation !== "object") return false;
	const binding = activations.get(activation);
	return (
		binding !== undefined &&
		binding.map === map &&
		binding.revision === map.getRevision() &&
		binding.mutationGeneration === map.getMutationGeneration() &&
		binding.portEquipment === portEquipment &&
		binding.organizations === organizations &&
		binding.relationships === relationships
	);
}

export function assertStaticFabAssemblyRelationshipActivation(
	activation: unknown,
	map: TileMap,
	portEquipment: PortEquipmentState,
	organizations: StaticFabOrganizationState,
	relationships: StaticFabAssemblyRelationshipStateV1,
): asserts activation is ValidatedStaticFabAssemblyRelationshipActivation {
	if (
		!staticFabAssemblyRelationshipActivationMatches(
			activation,
			map,
			portEquipment,
			organizations,
			relationships,
		)
	) {
		throw new Error("조립 관계 활성화가 현재 문서 generation과 일치하지 않습니다");
	}
}
