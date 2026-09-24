import {
	collectorBankFabOrganizationIdentities,
	describeCollectorBankFabRelationships,
} from "./CollectorBankFabRelationships";
import type { FullFabBankPlan, FullFabGatewayPlan } from "./FullFabAssemblyPlan";

export const FULL_FAB_ORGANIZATION_KEY = "FULL-FAB";

export function describeFullFabRelationships(
	banks: readonly FullFabBankPlan[],
	gateways: readonly FullFabGatewayPlan[],
) {
	return describeCollectorBankFabRelationships(FULL_FAB_ORGANIZATION_KEY, banks, gateways);
}

export function fullFabOrganizationIdentities(banks: readonly FullFabBankPlan[]) {
	return collectorBankFabOrganizationIdentities(
		FULL_FAB_ORGANIZATION_KEY,
		"Full Production FAB",
		banks,
	);
}
