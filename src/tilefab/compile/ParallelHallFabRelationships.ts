import {
	collectorBankFabOrganizationIdentities,
	describeCollectorBankFabRelationships,
} from "./CollectorBankFabRelationships";
import type {
	ParallelHallFabBankPlan,
	ParallelHallFabGatewayPlan,
} from "./ParallelHallFabAssemblyPlan";

export const PARALLEL_HALL_FAB_ORGANIZATION_KEY = "PARALLEL-HALL-FAB";

export function describeParallelHallFabRelationships(
	banks: readonly ParallelHallFabBankPlan[],
	gateways: readonly ParallelHallFabGatewayPlan[],
) {
	return describeCollectorBankFabRelationships(PARALLEL_HALL_FAB_ORGANIZATION_KEY, banks, gateways);
}

export function parallelHallFabOrganizationIdentities(banks: readonly ParallelHallFabBankPlan[]) {
	return collectorBankFabOrganizationIdentities(
		PARALLEL_HALL_FAB_ORGANIZATION_KEY,
		"Parallel Process Hall",
		banks,
	);
}
