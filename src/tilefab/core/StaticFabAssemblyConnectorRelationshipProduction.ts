import { completeCooperativeSteps } from "./CooperativeTask";
import type {
	StaticFabAssemblyConnectorPlan,
	StaticFabAssemblyConnectorPlanningResult,
	StaticFabAssemblyConnectorRelationshipProduction,
} from "./StaticFabAssemblyConnector";
import { describeStaticFabAssemblyConnectorRelationship } from "./StaticFabAssemblyConnectorRelationshipDescriptor";
import {
	applyStaticFabAssemblyRelationshipMutations,
	copyStaticFabAssemblyRelationshipRecordSteps,
	type StaticFabAssemblyRelationshipStateV1,
	staticFabAssemblyRelationshipStateShapeErrorSteps,
	staticFabAssemblyRelationshipStateSourceError,
} from "./StaticFabAssemblyRelationship";
import type { StaticFabOrganizationState } from "./StaticFabOrganization";

/** Produce one explicit relationship and validate it together with all existing dependencies. */
export function produceStaticFabAssemblyConnectorRelationship(
	sourceOrganizations: StaticFabOrganizationState,
	sourceRelationships: StaticFabAssemblyRelationshipStateV1,
	planning: StaticFabAssemblyConnectorPlanningResult,
): Readonly<{
	plan: StaticFabAssemblyConnectorPlan;
	relationships: StaticFabAssemblyRelationshipStateV1;
}> {
	if (!planning.prospectiveState || planning.plan.relationshipProduction !== null)
		throw new Error("새로운 Connector 계획의 관계만 생성할 수 있습니다");
	const record = describeStaticFabAssemblyConnectorRelationship(
		sourceOrganizations,
		planning,
		sourceRelationships.nextRelationshipId,
	).record;
	const production: StaticFabAssemblyConnectorRelationshipProduction = Object.freeze({
		nextRelationshipIdBefore: sourceRelationships.nextRelationshipId,
		nextRelationshipIdAfter: sourceRelationships.nextRelationshipId + 1,
		mutations: Object.freeze([Object.freeze({ id: record.id, before: null, after: record })]),
	});
	const relationships = applyStaticFabAssemblyRelationshipMutations(
		sourceRelationships,
		production.mutations,
		production.nextRelationshipIdAfter,
	);
	const error = staticFabAssemblyRelationshipStateSourceError(
		planning.prospectiveState.map,
		planning.prospectiveState.organizations,
		relationships,
	);
	if (error) throw new Error(`Connector 관계를 보존할 수 없습니다: ${error}`);
	return Object.freeze({
		plan: Object.freeze({ ...planning.plan, relationshipProduction: production }),
		relationships,
	});
}

export function staticFabAssemblyConnectorRelationshipProductionShapeError(
	value: unknown,
): string | null {
	return completeCooperativeSteps(
		staticFabAssemblyConnectorRelationshipProductionShapeErrorSteps(value),
	);
}

export function* staticFabAssemblyConnectorRelationshipProductionShapeErrorSteps(
	value: unknown,
): Generator<void, string | null> {
	if (!value || typeof value !== "object") return "Connector 관계 생성 결과가 없습니다";
	const candidate = value as Partial<StaticFabAssemblyConnectorRelationshipProduction>;
	const before = candidate.nextRelationshipIdBefore;
	if (
		typeof before !== "number" ||
		!Number.isInteger(before) ||
		before < 1 ||
		before >= 2_147_483_647 ||
		candidate.nextRelationshipIdAfter !== before + 1 ||
		!Array.isArray(candidate.mutations) ||
		candidate.mutations.length !== 1
	)
		return "Connector 관계 ID 할당이 잘못되었습니다";
	const change = candidate.mutations[0];
	if (
		!change ||
		change.id !== before ||
		change.before !== null ||
		!change.after ||
		change.after.id !== before
	)
		return "Connector는 할당된 ID의 새 관계 한 건만 생성해야 합니다";
	return yield* staticFabAssemblyRelationshipStateShapeErrorSteps({
		nextRelationshipId: before + 1,
		records: [change.after],
	});
}

export function copyStaticFabAssemblyConnectorRelationshipProduction(
	production: StaticFabAssemblyConnectorRelationshipProduction,
): StaticFabAssemblyConnectorRelationshipProduction {
	return completeCooperativeSteps(
		copyStaticFabAssemblyConnectorRelationshipProductionSteps(production),
	);
}

export function* copyStaticFabAssemblyConnectorRelationshipProductionSteps(
	production: StaticFabAssemblyConnectorRelationshipProduction,
): Generator<void, StaticFabAssemblyConnectorRelationshipProduction> {
	const error = yield* staticFabAssemblyConnectorRelationshipProductionShapeErrorSteps(production);
	if (error) throw new Error(error);
	const change = production.mutations[0];
	if (!change?.after) throw new Error("Connector production record is missing.");
	return Object.freeze({
		nextRelationshipIdBefore: production.nextRelationshipIdBefore,
		nextRelationshipIdAfter: production.nextRelationshipIdAfter,
		mutations: Object.freeze([
			Object.freeze({
				id: change.id,
				before: null,
				after: yield* copyStaticFabAssemblyRelationshipRecordSteps(change.after),
			}),
		]),
	});
}
