import {
	type EquipmentGroupRecord,
	emptyPortEquipmentState,
	type PortEquipmentState,
} from "../core/EquipmentGroup";
import type { PortRouteIdentity } from "../core/PortRecord";
import {
	resolveStaticFabOrganizationCoverage,
	staticFabOrganizationEdgeKey,
	staticFabOrganizationMembershipSupportsPortRoute,
} from "../core/StaticFabOrganization";
import {
	type StaticFabOuterCirculationIndex,
	staticFabBankPairHasResilientCirculationInIndex,
} from "../core/StaticFabOuterCirculation";
import type { GuidedBuildEquipmentEvidence } from "./GuidedBuildMission";

export interface GuidedBuildFabEquipmentScope {
	readonly organizationId: number;
	readonly name: string;
	readonly acceptsRoute: (route: PortRouteIdentity) => boolean;
}

export interface GuidedBuildFabEquipmentEvidence {
	readonly organizationId: number | null;
	readonly name: string;
	readonly equipment: GuidedBuildEquipmentEvidence;
}

/** Keep the target stable as equipment is added: the lowest eligible authored FAB ID wins. */
export function createGuidedBuildFabEquipmentScope(
	index: StaticFabOuterCirculationIndex,
): GuidedBuildFabEquipmentScope | null {
	const candidates = [...index.fabs].sort((left, right) => left.id - right.id);
	for (const fab of candidates) {
		if (fab.membership.railEdges.length === 0) continue;
		const banks = (index.childrenByParentId.get(fab.id) ?? []).filter(
			(record) => index.roles.get(record.id) === "BAY_BANK",
		);
		if (banks.length < 2) continue;
		let resilient = true;
		for (let left = 0; resilient && left < banks.length; left++) {
			for (let right = left + 1; right < banks.length; right++) {
				if (
					!staticFabBankPairHasResilientCirculationInIndex(
						index,
						fab.id,
						(banks[left] as (typeof banks)[number]).id,
						(banks[right] as (typeof banks)[number]).id,
					)
				) {
					resilient = false;
					break;
				}
			}
		}
		if (!resilient) continue;
		const coverage = resolveStaticFabOrganizationCoverage(index.source, fab.id);
		if (!coverage) continue;
		const edges = new Set(coverage.effective.railEdges.map(staticFabOrganizationEdgeKey));
		const switches = new Set(coverage.effective.advancedSwitchIds);
		return Object.freeze({
			organizationId: fab.id,
			name: fab.name,
			acceptsRoute: (route: PortRouteIdentity) =>
				staticFabOrganizationMembershipSupportsPortRoute(route, edges, switches),
		});
	}
	return null;
}

export function summarizeGuidedBuildEquipment(
	state: PortEquipmentState,
	acceptsGroup?: (group: EquipmentGroupRecord) => boolean,
): GuidedBuildEquipmentEvidence {
	const summary = {
		OHB: { groupCount: 0, portCount: 0, largestGroupPortCount: 0 },
		EQ: { groupCount: 0, portCount: 0, largestGroupPortCount: 0 },
		STK: { groupCount: 0, portCount: 0, largestGroupPortCount: 0 },
	};
	for (const group of state.equipmentGroups) {
		if (acceptsGroup && !acceptsGroup(group)) continue;
		const kind = summary[group.kind];
		kind.groupCount++;
		kind.portCount += group.portIds.length;
		kind.largestGroupPortCount = Math.max(kind.largestGroupPortCount, group.portIds.length);
	}
	return Object.freeze({
		OHB: Object.freeze(summary.OHB),
		EQ: Object.freeze(summary.EQ),
		STK: Object.freeze(summary.STK),
	});
}

export const EMPTY_GUIDED_BUILD_FAB_EQUIPMENT: GuidedBuildFabEquipmentEvidence = Object.freeze({
	organizationId: null,
	name: "",
	equipment: summarizeGuidedBuildEquipment(emptyPortEquipmentState()),
});

/** Physical attachment is derived evidence; it never writes implicit organization membership. */
export function summarizeGuidedBuildFabEquipment(
	scope: GuidedBuildFabEquipmentScope | null,
	state: PortEquipmentState,
): GuidedBuildFabEquipmentEvidence {
	if (!scope) return EMPTY_GUIDED_BUILD_FAB_EQUIPMENT;
	const ports = new Map(state.ports.map((port) => [port.id, port] as const));
	return Object.freeze({
		organizationId: scope.organizationId,
		name: scope.name,
		equipment: summarizeGuidedBuildEquipment(state, (group) =>
			Boolean(
				group.portIds.length > 0 &&
					group.portIds.every((id) => {
						const port = ports.get(id);
						return (
							port?.equipmentGroupId === group.id &&
							port.portType === group.kind &&
							scope.acceptsRoute(port.route)
						);
					}),
			),
		),
	});
}
