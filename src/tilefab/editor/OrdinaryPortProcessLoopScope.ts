import { type CompiledPortSlots, PORT_SLOT_STATUS } from "../compile/PortSlotCompiler";
import type { CardinalPortRoute } from "../core/PortRecord";
import {
	type StaticFabOrganizationRecord,
	staticFabOrganizationEdgeKey,
	staticFabOrganizationMembershipSupportsPortRoute,
} from "../core/StaticFabOrganization";

export interface OrdinaryPortProcessLoopScope {
	/** Derived slot and authored organization generations used to build this scope. */
	readonly slots: CompiledPortSlots;
	readonly organization: StaticFabOrganizationRecord;
	readonly organizationId: number;
	/** A row is 1 only when it is currently legal and its whole cardinal route is directly owned. */
	readonly rowMask: Uint8Array;
	readonly eligibleCount: number;
}

/**
 * Restrict one compiled Port catalog to the selected Process Loop's direct rail membership.
 * The caller resolves the record's semantic role and rechecks source identity before commit.
 */
export function compileOrdinaryPortProcessLoopScope(
	slots: CompiledPortSlots,
	organization: StaticFabOrganizationRecord,
): OrdinaryPortProcessLoopScope {
	const rowMask = new Uint8Array(slots.count);
	let eligibleCount = 0;
	if (organization.membership.railEdges.length > 0) {
		const edges = new Set(organization.membership.railEdges.map(staticFabOrganizationEdgeKey));
		const switches = new Set(organization.membership.advancedSwitchIds);
		for (let row = 0; row < slots.count; row++) {
			if (slots.statuses[row] !== PORT_SLOT_STATUS.LEGAL) continue;
			const from = slots.routeFromDirections[row] as CardinalPortRoute["from"];
			const to = slots.routeToDirections[row] as CardinalPortRoute["to"];
			if (from === 0 || to === 0) continue;
			const route: CardinalPortRoute = {
				kind: "CARDINAL_CELL",
				x: slots.routeXs[row] as number,
				z: slots.routeZs[row] as number,
				from,
				to,
			};
			if (!staticFabOrganizationMembershipSupportsPortRoute(route, edges, switches)) continue;
			rowMask[row] = 1;
			eligibleCount++;
		}
	}
	return Object.freeze({
		slots,
		organization,
		organizationId: organization.id,
		rowMask,
		eligibleCount,
	});
}

/** Reject a scope after either derived slots or the direct authored membership changes. */
export function ordinaryPortProcessLoopScopeMatches(
	scope: OrdinaryPortProcessLoopScope,
	slots: CompiledPortSlots,
	organization: StaticFabOrganizationRecord,
): boolean {
	return scope.slots === slots && scope.organization === organization;
}
