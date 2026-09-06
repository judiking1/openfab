import { describe, expect, it } from "vitest";
import {
	certifyProductionBayModuleCatalogRequest,
	defaultProductionBayModuleCatalogRequest,
} from "../compile/ProductionBayModuleCatalog";
import { emptyPortEquipmentState } from "./EquipmentGroup";
import { analyzeRailNetwork } from "./network";
import {
	discoverStaticFabAssemblyGateways,
	discoverStaticFabOuterCirculationGateways,
	planStaticFabAssemblyConnectorWithProspectiveState,
	STATIC_FAB_ASSEMBLY_CONNECTOR_VERSION,
	STATIC_FAB_ASSEMBLY_GATEWAY_MINIMUM_RUN_METERS,
	type StaticFabAssemblyConnectorIntent,
	type StaticFabAssemblyConnectorPlanningResult,
	staticFabAssemblyConnectorHierarchyEligibility,
	staticFabAssemblyConnectorNetworkEligibility,
	staticFabAssemblyConnectorSelectionBounds,
	staticFabAssemblyInterbayConnectorHierarchyEligibility,
} from "./StaticFabAssemblyConnector";
import { emptyStaticFabAssemblyRelationshipState } from "./StaticFabAssemblyRelationship";
import {
	compareDirectedRailEdges,
	copyStaticFabOrganizationRecord,
	deriveStaticFabOrganizationSemanticRoles,
	emptyStaticFabOrganizationState,
	type StaticFabOrganizationRecord,
	type StaticFabOrganizationState,
	staticFabOrganizationParentIds,
	staticFabOrganizationStateError,
} from "./StaticFabOrganization";
import {
	planStaticFabOrganizationBundlePlacementWithProspectiveState,
	type StaticFabOrganizationBundlePlacementProspectiveState,
} from "./StaticFabOrganizationBundlePlacement";
import { staticFabBankPairHasResilientCirculation } from "./StaticFabOuterCirculation";
import { TileMap } from "./TileMap";

interface FixtureState extends StaticFabOrganizationBundlePlacementProspectiveState {
	readonly patchSequence: number;
}

describe("StaticFabAssemblyConnector", () => {
	it("discovers deterministic outer-shell gateways only for authored Production Bays", () => {
		const fixture = placeProductionBays([{ x: 0, y: 0 }]);
		const bay = fixture.organizations.records.find((record) => record.kind === "BAY");
		const processLoop = fixture.organizations.records.find((record) => record.kind === "AISLE");
		if (!bay || !processLoop) throw new Error("Expected one Production Bay hierarchy.");

		const first = discoverStaticFabAssemblyGateways(fixture.map, fixture.organizations, bay.id);
		const second = discoverStaticFabAssemblyGateways(fixture.map, fixture.organizations, bay.id);
		expect(first.length).toBeGreaterThanOrEqual(2);
		expect(first).toEqual(second);
		expect(
			first.every(
				(gateway) =>
					gateway.organizationId === bay.id &&
					gateway.runLengthMeters >= STATIC_FAB_ASSEMBLY_GATEWAY_MINIMUM_RUN_METERS &&
					fixture.map.hasRail(gateway.anchor.x, gateway.anchor.y),
			),
		).toBe(true);
		expect(
			discoverStaticFabAssemblyGateways(fixture.map, fixture.organizations, processLoop.id),
		).toEqual([]);
	});

	it("derives Connector framing bounds from selected organization membership only", () => {
		const fixture = placeProductionBays([
			{ x: 0, y: 0 },
			{ x: 100, y: 40 },
		]);
		const bays = fixture.organizations.records.filter((record) => record.kind === "BAY");
		const selectedEdges = bays.flatMap((bay) => bay.membership.railEdges);
		expect(
			staticFabAssemblyConnectorSelectionBounds(
				fixture.organizations,
				bays.map((bay) => bay.id),
			),
		).toEqual({
			minX: Math.min(...selectedEdges.flatMap((edge) => [edge.from.x, edge.to.x])),
			minY: Math.min(...selectedEdges.flatMap((edge) => [edge.from.y, edge.to.y])),
			maxX: Math.max(...selectedEdges.flatMap((edge) => [edge.from.x, edge.to.x])),
			maxY: Math.max(...selectedEdges.flatMap((edge) => [edge.from.y, edge.to.y])),
		});
		expect(staticFabAssemblyConnectorSelectionBounds(fixture.organizations, [999_999])).toBeNull();
	});

	it("connects two detached Bays as one atomic prospective Bay Bank hierarchy", () => {
		const fixture = placeProductionBays([
			{ x: 0, y: 0 },
			{ x: 100, y: 0 },
		]);
		const bays = fixture.organizations.records.filter((record) => record.kind === "BAY");
		expect(bays).toHaveLength(2);
		const result = firstValidConnector(fixture, bays[0]?.id ?? -1, bays[1]?.id ?? -1);

		expect(result.plan.valid, result.plan.reason).toBe(true);
		expect(result.plan.assemblyConnector).toMatchObject({
			createdBank: true,
			issueCode: null,
		});
		expect(result.plan.organizationMutations.length).toBeGreaterThanOrEqual(3);
		expect(result.prospectiveState).not.toBeNull();
		const prospective =
			result.prospectiveState as StaticFabOrganizationBundlePlacementProspectiveState;
		expect(
			staticFabOrganizationStateError(
				prospective.map,
				prospective.portEquipment,
				prospective.organizations,
			),
		).toBeNull();
		expect(analyzeRailNetwork(prospective.map)).toMatchObject({
			components: 1,
			strongComponents: 1,
		});

		const bankId = result.plan.assemblyConnector.bankOrganizationId;
		expect(bankId).not.toBeNull();
		const roles = deriveStaticFabOrganizationSemanticRoles(prospective.organizations);
		expect(roles.get(bankId as number)).toBe("BAY_BANK");
		for (const bay of prospective.organizations.records.filter((record) => record.kind === "BAY")) {
			expect(staticFabOrganizationParentIds(bay)).toContain(bankId);
		}
		const bank = prospective.organizations.records.find((record) => record.id === bankId);
		expect(bank?.membership.railEdges.length).toBeGreaterThan(0);
	});

	it("connects two detached Bay Banks through one Fab-owned typed Interbay", () => {
		const placed = placeProductionBays([
			{ x: 0, y: 0 },
			{ x: 100, y: 0 },
			{ x: 300, y: 0 },
			{ x: 400, y: 0 },
		]);
		const bays = placed.organizations.records.filter((record) => record.kind === "BAY");
		const left = firstValidConnector(placed, bays[0]?.id ?? -1, bays[1]?.id ?? -1);
		if (!left.prospectiveState) throw new Error(left.plan.reason);
		const afterLeft: FixtureState = {
			relationships: emptyStaticFabAssemblyRelationshipState(),
			...left.prospectiveState,
			patchSequence: placed.patchSequence + 1,
		};
		const right = firstValidConnector(afterLeft, bays[2]?.id ?? -1, bays[3]?.id ?? -1);
		if (!right.prospectiveState) throw new Error(right.plan.reason);
		const detachedBanks: FixtureState = {
			relationships: emptyStaticFabAssemblyRelationshipState(),
			...right.prospectiveState,
			patchSequence: afterLeft.patchSequence + 1,
		};
		const roles = deriveStaticFabOrganizationSemanticRoles(detachedBanks.organizations);
		const banks = detachedBanks.organizations.records.filter(
			(record) => roles.get(record.id) === "BAY_BANK",
		);
		expect(banks).toHaveLength(2);
		expect(
			staticFabAssemblyInterbayConnectorHierarchyEligibility(
				detachedBanks.organizations,
				banks[0]?.id ?? -1,
				banks[1]?.id ?? -1,
			),
		).toMatchObject({ valid: true, issueCode: null });

		const result = firstValidConnector(detachedBanks, banks[0]?.id ?? -1, banks[1]?.id ?? -1);
		expect(result.plan.valid, result.plan.reason).toBe(true);
		expect(result.plan.assemblyConnector).toMatchObject({
			hierarchyRole: "BANK_TO_FAB",
			bankOrganizationId: null,
			createdBank: false,
			createdFab: true,
			issueCode: null,
		});
		const fabId = result.plan.assemblyConnector.fabOrganizationId;
		expect(fabId).not.toBeNull();
		if (!result.prospectiveState) throw new Error(result.plan.reason);
		const prospective = result.prospectiveState;
		expect(
			staticFabOrganizationStateError(
				prospective.map,
				prospective.portEquipment,
				prospective.organizations,
			),
		).toBeNull();
		const prospectiveRoles = deriveStaticFabOrganizationSemanticRoles(prospective.organizations);
		expect(prospectiveRoles.get(fabId as number)).toBe("FAB");
		for (const bank of banks) {
			const updated = prospective.organizations.records.find((record) => record.id === bank.id);
			expect(staticFabOrganizationParentIds(updated as StaticFabOrganizationRecord)).toContain(
				fabId,
			);
			expect(updated?.membership.railEdges.length).toBeGreaterThan(0);
		}
		const fab = prospective.organizations.records.find((record) => record.id === fabId);
		expect(fab?.membership.railEdges.length).toBeGreaterThan(0);
		expect(analyzeRailNetwork(prospective.map)).toMatchObject({
			components: 1,
			strongComponents: 1,
		});

		const connectedFab: FixtureState = {
			relationships: emptyStaticFabAssemblyRelationshipState(),
			...prospective,
			patchSequence: detachedBanks.patchSequence + 1,
		};
		expect(
			staticFabAssemblyInterbayConnectorHierarchyEligibility(
				connectedFab.organizations,
				banks[0]?.id ?? -1,
				banks[1]?.id ?? -1,
			),
		).toMatchObject({ valid: true, issueCode: null, purpose: "FAB_LOOP" });
		const outer = firstValidConnector(connectedFab, banks[0]?.id ?? -1, banks[1]?.id ?? -1);
		expect(outer.plan.valid, outer.plan.reason).toBe(true);
		expect(outer.plan.assemblyConnector).toMatchObject({
			hierarchyRole: "BANK_TO_FAB",
			purpose: "FAB_LOOP",
			fabOrganizationId: fabId,
			createdFab: false,
			issueCode: null,
		});
		expect(outer.plan.nextOrganizationIdAfter).toBe(outer.plan.nextOrganizationIdBefore);
		if (!outer.prospectiveState) throw new Error(outer.plan.reason);
		expect(
			staticFabOrganizationStateError(
				outer.prospectiveState.map,
				outer.prospectiveState.portEquipment,
				outer.prospectiveState.organizations,
			),
		).toBeNull();
		expect(analyzeRailNetwork(outer.prospectiveState.map)).toMatchObject({
			components: 1,
			strongComponents: 1,
			openEnds: 0,
		});
		expect(
			staticFabBankPairHasResilientCirculation(
				outer.prospectiveState.organizations,
				fabId as number,
				banks[0]?.id ?? -1,
				banks[1]?.id ?? -1,
			),
		).toBe(true);
		const completedSources = discoverStaticFabOuterCirculationGateways(
			outer.prospectiveState.map,
			outer.prospectiveState.organizations,
			banks[0]?.id ?? -1,
		);
		const completedTargets = discoverStaticFabOuterCirculationGateways(
			outer.prospectiveState.map,
			outer.prospectiveState.organizations,
			banks[1]?.id ?? -1,
		);
		const repeated = planStaticFabAssemblyConnectorWithProspectiveState(
			outer.prospectiveState.map,
			outer.prospectiveState.portEquipment,
			connectedFab.patchSequence + 1,
			outer.prospectiveState.organizations,
			{
				version: STATIC_FAB_ASSEMBLY_CONNECTOR_VERSION,
				purpose: "FAB_LOOP",
				sourceOrganizationId: banks[0]?.id ?? -1,
				sourceGatewayId: completedSources[0]?.id ?? "missing",
				sourceAnchor: completedSources[0]?.anchor ?? { x: 0, y: 0 },
				targetOrganizationId: banks[1]?.id ?? -1,
				targetGatewayId: completedTargets[0]?.id ?? "missing",
				targetAnchor: completedTargets[0]?.anchor ?? { x: 0, y: 0 },
				side: null,
			},
		);
		expect(repeated.plan).toMatchObject({
			valid: false,
			assemblyConnector: { issueCode: "ALREADY_CONNECTED" },
		});
		expect(repeated.plan.reason).toContain("이미 독립적인 outbound·return 순환 경로");
	});

	it("accepts gateway rails inherited by their Bay Bank and FAB ancestors", () => {
		const fixture = placeProductionBays([
			{ x: 0, y: 0 },
			{ x: 100, y: 0 },
			{ x: 200, y: 0 },
		]);
		const bays = fixture.organizations.records.filter((record) => record.kind === "BAY");
		const [source, target, fabMembershipBay] = bays;
		if (!source || !target || !fabMembershipBay) throw new Error("Expected three Bays.");
		const bankId = fixture.organizations.nextOrganizationId;
		const fabId = bankId + 1;
		const bankMembership = mergeMembership(source, target);
		const organizations = withHierarchy(fixture.organizations, [
			withParents(source, [bankId]),
			withParents(target, [bankId]),
			areaWithMembership(bankId, "Shared Bay Bank", bankMembership, [fabId]),
			area(fabId, "Production Fab", fabMembershipBay, []),
		]);
		expect(
			staticFabOrganizationStateError(fixture.map, fixture.portEquipment, organizations),
		).toBeNull();

		const result = firstValidConnector({ ...fixture, organizations }, source.id, target.id);
		expect(result.plan.valid, result.plan.reason).toBe(true);
		expect(result.plan.assemblyConnector).toMatchObject({
			bankOrganizationId: bankId,
			createdBank: false,
		});
	});

	it("rejects a gateway rail directly shared by another Bay", () => {
		const fixture = placeProductionBays([
			{ x: 0, y: 0 },
			{ x: 100, y: 0 },
			{ x: 200, y: 0 },
		]);
		const bays = fixture.organizations.records.filter((record) => record.kind === "BAY");
		const [source, target] = bays;
		const overlapping = fixture.organizations.records.find(
			(record) =>
				record.kind === "AISLE" &&
				staticFabOrganizationParentIds(record).includes(source?.id ?? -1),
		);
		if (!source || !target || !overlapping) {
			throw new Error("Expected two Bays and one child Process Loop.");
		}
		const organizations = withHierarchy(fixture.organizations, [
			copyStaticFabOrganizationRecord({
				...overlapping,
				membership: mergeMembership(overlapping, source),
			}),
		]);
		const sourceGateway = discoverStaticFabAssemblyGateways(
			fixture.map,
			organizations,
			source.id,
		)[0];
		const targetGateway = discoverStaticFabAssemblyGateways(
			fixture.map,
			organizations,
			target.id,
		)[0];
		if (!sourceGateway || !targetGateway) throw new Error("Expected Assembly gateways.");
		const result = planStaticFabAssemblyConnectorWithProspectiveState(
			fixture.map,
			fixture.portEquipment,
			fixture.patchSequence,
			organizations,
			{
				version: STATIC_FAB_ASSEMBLY_CONNECTOR_VERSION,
				purpose: "HIERARCHY_LINK",
				sourceOrganizationId: source.id,
				sourceGatewayId: sourceGateway.id,
				sourceAnchor: sourceGateway.anchor,
				targetOrganizationId: target.id,
				targetGatewayId: targetGateway.id,
				targetAnchor: targetGateway.anchor,
				side: null,
			},
		);

		expect(result.plan).toMatchObject({
			valid: false,
			assemblyConnector: { issueCode: "AMBIGUOUS_GATEWAY_OWNERSHIP" },
		});
	});

	it("rejects a stale gateway identity even when its anchor names a current Bay rail", () => {
		const fixture = placeProductionBays([
			{ x: 0, y: 0 },
			{ x: 100, y: 0 },
		]);
		const bays = fixture.organizations.records.filter((record) => record.kind === "BAY");
		const source = discoverStaticFabAssemblyGateways(
			fixture.map,
			fixture.organizations,
			bays[0]?.id ?? -1,
		)[0];
		const target = discoverStaticFabAssemblyGateways(
			fixture.map,
			fixture.organizations,
			bays[1]?.id ?? -1,
		)[0];
		if (!source || !target) throw new Error("Expected Assembly gateways.");
		const result = planStaticFabAssemblyConnectorWithProspectiveState(
			fixture.map,
			fixture.portEquipment,
			fixture.patchSequence,
			fixture.organizations,
			{
				version: STATIC_FAB_ASSEMBLY_CONNECTOR_VERSION,
				purpose: "HIERARCHY_LINK",
				sourceOrganizationId: source.organizationId,
				sourceGatewayId: `${source.id}:stale`,
				sourceAnchor: source.anchor,
				targetOrganizationId: target.organizationId,
				targetGatewayId: target.id,
				targetAnchor: target.anchor,
				side: null,
			},
		);

		expect(result.plan).toMatchObject({
			valid: false,
			assemblyConnector: { issueCode: "ANCHOR_OUTSIDE_ORGANIZATION" },
			organizationMutations: [],
		});
		expect(result.prospectiveState).toBeNull();
	});

	it("extends an existing Bay Bank when a third detached Bay is connected", () => {
		const fixture = placeProductionBays([
			{ x: 0, y: 0 },
			{ x: 100, y: 0 },
			{ x: 200, y: 0 },
		]);
		const initialBays = fixture.organizations.records.filter((record) => record.kind === "BAY");
		const first = firstValidConnector(fixture, initialBays[0]?.id ?? -1, initialBays[1]?.id ?? -1);
		if (!first.prospectiveState) throw new Error(first.plan.reason);
		const afterFirst: FixtureState = {
			relationships: emptyStaticFabAssemblyRelationshipState(),
			...first.prospectiveState,
			patchSequence: fixture.patchSequence + 1,
		};
		const firstBankId = first.plan.assemblyConnector.bankOrganizationId;
		const second = firstValidConnector(
			afterFirst,
			initialBays[1]?.id ?? -1,
			initialBays[2]?.id ?? -1,
		);

		expect(second.plan.valid, second.plan.reason).toBe(true);
		expect(second.plan.assemblyConnector).toMatchObject({
			bankOrganizationId: firstBankId,
			createdBank: false,
		});
		expect(second.plan.nextOrganizationIdAfter).toBe(second.plan.nextOrganizationIdBefore);
		if (!second.prospectiveState) throw new Error(second.plan.reason);
		const thirdBay = second.prospectiveState.organizations.records.find(
			(record) => record.id === initialBays[2]?.id,
		);
		expect(staticFabOrganizationParentIds(thirdBay as NonNullable<typeof thirdBay>)).toContain(
			firstBankId,
		);
		expect(analyzeRailNetwork(second.prospectiveState.map)).toMatchObject({
			components: 1,
			strongComponents: 1,
		});
	});

	it("explains that two Bays already sharing one FAB circulation network cannot be linked twice", () => {
		const fixture = placeProductionBays([
			{ x: 0, y: 0 },
			{ x: 100, y: 0 },
		]);
		const bays = fixture.organizations.records.filter((record) => record.kind === "BAY");
		expect(
			staticFabAssemblyConnectorNetworkEligibility(
				fixture.map,
				fixture.organizations,
				bays[0]?.id ?? -1,
				bays[1]?.id ?? -1,
				"BAY_TO_BANK",
			),
		).toMatchObject({ valid: true, issueCode: null });
		const first = firstValidConnector(fixture, bays[0]?.id ?? -1, bays[1]?.id ?? -1);
		if (!first.prospectiveState) throw new Error(first.plan.reason);
		const connected: FixtureState = {
			relationships: emptyStaticFabAssemblyRelationshipState(),
			...first.prospectiveState,
			patchSequence: fixture.patchSequence + 1,
		};
		const sourceGateway = discoverStaticFabAssemblyGateways(
			connected.map,
			connected.organizations,
			bays[0]?.id ?? -1,
		)[0];
		const targetGateway = discoverStaticFabAssemblyGateways(
			connected.map,
			connected.organizations,
			bays[1]?.id ?? -1,
		)[0];
		if (!sourceGateway || !targetGateway) throw new Error("Expected connected Bay gateways.");
		expect(
			staticFabAssemblyConnectorNetworkEligibility(
				connected.map,
				connected.organizations,
				bays[0]?.id ?? -1,
				bays[1]?.id ?? -1,
				"BAY_TO_BANK",
			),
		).toEqual({
			valid: false,
			issueCode: "ALREADY_CONNECTED",
			reason:
				"두 Production Bay는 이미 같은 FAB 순환망에 연결되어 있습니다 · 중복 조립 연결은 만들지 않습니다",
		});

		const duplicate = planStaticFabAssemblyConnectorWithProspectiveState(
			connected.map,
			connected.portEquipment,
			connected.patchSequence,
			connected.organizations,
			{
				version: STATIC_FAB_ASSEMBLY_CONNECTOR_VERSION,
				purpose: "HIERARCHY_LINK",
				sourceOrganizationId: sourceGateway.organizationId,
				sourceGatewayId: sourceGateway.id,
				sourceAnchor: sourceGateway.anchor,
				targetOrganizationId: targetGateway.organizationId,
				targetGatewayId: targetGateway.id,
				targetAnchor: targetGateway.anchor,
				side: null,
			},
		);

		expect(duplicate.plan).toMatchObject({
			valid: false,
			reason:
				"두 Production Bay는 이미 같은 FAB 순환망에 연결되어 있습니다 · 중복 조립 연결은 만들지 않습니다",
			assemblyConnector: { issueCode: "ALREADY_CONNECTED" },
		});
		expect(duplicate.prospectiveState).toBeNull();
	});

	it("rejects Process Loop endpoints before constructing organization mutations", () => {
		const fixture = placeProductionBays([
			{ x: 0, y: 0 },
			{ x: 100, y: 0 },
		]);
		const loops = fixture.organizations.records.filter((record) => record.kind === "AISLE");
		const source = loops[0];
		const target = loops[1];
		if (!source || !target) throw new Error("Expected Process Loop organizations.");
		const sourceEdge = source.membership.railEdges[0];
		const targetEdge = target.membership.railEdges[0];
		if (!sourceEdge || !targetEdge) throw new Error("Expected Process Loop rail membership.");
		const result = planStaticFabAssemblyConnectorWithProspectiveState(
			fixture.map,
			fixture.portEquipment,
			fixture.patchSequence,
			fixture.organizations,
			{
				version: STATIC_FAB_ASSEMBLY_CONNECTOR_VERSION,
				purpose: "HIERARCHY_LINK",
				sourceOrganizationId: source.id,
				sourceGatewayId: `unsupported:${source.id}`,
				sourceAnchor: sourceEdge.from,
				targetOrganizationId: target.id,
				targetGatewayId: `unsupported:${target.id}`,
				targetAnchor: targetEdge.from,
				side: null,
			},
		);

		expect(result.plan.valid).toBe(false);
		expect(result.plan.assemblyConnector.issueCode).toBe("UNSUPPORTED_ORGANIZATION");
		expect(result.plan.organizationMutations).toEqual([]);
		expect(result.prospectiveState).toBeNull();
	});

	it("preserves one shared FAB parent by inserting the new Bay Bank between it and both Bays", () => {
		const fixture = placeProductionBays([
			{ x: 0, y: 0 },
			{ x: 100, y: 0 },
			{ x: 200, y: 0 },
			{ x: 300, y: 0 },
		]);
		const bays = fixture.organizations.records.filter((record) => record.kind === "BAY");
		const [source, target, existingBankBay, fabMembershipBay] = bays;
		if (!source || !target || !existingBankBay || !fabMembershipBay) {
			throw new Error("Expected four Production Bays.");
		}
		const existingBankId = fixture.organizations.nextOrganizationId;
		const fabId = existingBankId + 1;
		const organizations = withHierarchy(fixture.organizations, [
			withParents(source, [fabId]),
			withParents(target, [fabId]),
			withParents(existingBankBay, [existingBankId]),
			area(existingBankId, "Existing Bay Bank", existingBankBay, [fabId]),
			area(fabId, "Existing Fab", fabMembershipBay, []),
		]);
		expect(
			staticFabOrganizationStateError(fixture.map, fixture.portEquipment, organizations),
		).toBeNull();
		expect(deriveStaticFabOrganizationSemanticRoles(organizations).get(fabId)).toBe("FAB");
		expect(
			staticFabAssemblyConnectorHierarchyEligibility(organizations, source.id, target.id),
		).toMatchObject({ valid: true, issueCode: null });

		const result = firstValidConnector({ ...fixture, organizations }, source.id, target.id);
		expect(result.plan.valid, result.plan.reason).toBe(true);
		if (!result.prospectiveState) throw new Error(result.plan.reason);
		const newBankId = result.plan.assemblyConnector.bankOrganizationId;
		expect(newBankId).not.toBeNull();
		const roles = deriveStaticFabOrganizationSemanticRoles(result.prospectiveState.organizations);
		expect(roles.get(newBankId as number)).toBe("BAY_BANK");
		expect(roles.get(fabId)).toBe("FAB");
		const newBank = result.prospectiveState.organizations.records.find(
			(record) => record.id === newBankId,
		);
		expect(staticFabOrganizationParentIds(newBank as StaticFabOrganizationRecord)).toEqual([fabId]);
		for (const id of [source.id, target.id]) {
			const bay = result.prospectiveState.organizations.records.find((record) => record.id === id);
			expect(staticFabOrganizationParentIds(bay as StaticFabOrganizationRecord)).toEqual([
				newBankId,
			]);
		}
	});

	it("rejects selection-time compatibility across two existing Bay Banks", () => {
		const fixture = placeProductionBays([
			{ x: 0, y: 0 },
			{ x: 100, y: 0 },
			{ x: 200, y: 0 },
			{ x: 300, y: 0 },
		]);
		const [source, target, leftBankBay, rightBankBay] = fixture.organizations.records.filter(
			(record) => record.kind === "BAY",
		);
		if (!source || !target || !leftBankBay || !rightBankBay) {
			throw new Error("Expected four Production Bays.");
		}
		const leftBankId = fixture.organizations.nextOrganizationId;
		const rightBankId = leftBankId + 1;
		const organizations = withHierarchy(fixture.organizations, [
			withParents(source, [leftBankId]),
			withParents(target, [rightBankId]),
			area(leftBankId, "Left Bay Bank", leftBankBay, []),
			area(rightBankId, "Right Bay Bank", rightBankBay, []),
		]);

		expect(
			staticFabAssemblyConnectorHierarchyEligibility(organizations, source.id, target.id),
		).toMatchObject({
			valid: false,
			issueCode: "DIFFERENT_BANKS",
			reason: expect.stringContaining("Bank/FAB connector"),
		});
	});

	it("rejects Bays whose direct FAB parents differ before planning connector mutations", () => {
		const fixture = placeProductionBays([
			{ x: 0, y: 0 },
			{ x: 100, y: 0 },
			{ x: 200, y: 0 },
			{ x: 300, y: 0 },
			{ x: 400, y: 0 },
			{ x: 500, y: 0 },
		]);
		const bays = fixture.organizations.records.filter((record) => record.kind === "BAY");
		const [source, target, leftBankBay, rightBankBay, leftFabBay, rightFabBay] = bays;
		if (!source || !target || !leftBankBay || !rightBankBay || !leftFabBay || !rightFabBay) {
			throw new Error("Expected six Production Bays.");
		}
		const leftBankId = fixture.organizations.nextOrganizationId;
		const rightBankId = leftBankId + 1;
		const leftFabId = rightBankId + 1;
		const rightFabId = leftFabId + 1;
		const organizations = withHierarchy(fixture.organizations, [
			withParents(source, [leftFabId]),
			withParents(target, [rightFabId]),
			withParents(leftBankBay, [leftBankId]),
			withParents(rightBankBay, [rightBankId]),
			area(leftBankId, "Left Bay Bank", leftBankBay, [leftFabId]),
			area(rightBankId, "Right Bay Bank", rightBankBay, [rightFabId]),
			area(leftFabId, "Left Fab", leftFabBay, []),
			area(rightFabId, "Right Fab", rightFabBay, []),
		]);
		expect(
			staticFabOrganizationStateError(fixture.map, fixture.portEquipment, organizations),
		).toBeNull();
		expect(
			staticFabAssemblyConnectorHierarchyEligibility(organizations, source.id, target.id),
		).toMatchObject({ valid: false, issueCode: "HIERARCHY_INVALID" });
		const sources = discoverStaticFabAssemblyGateways(fixture.map, organizations, source.id);
		const targets = discoverStaticFabAssemblyGateways(fixture.map, organizations, target.id);
		const sourceGateway = sources[0];
		const targetGateway = targets[0];
		if (!sourceGateway || !targetGateway) throw new Error("Expected Assembly gateways.");
		const result = planStaticFabAssemblyConnectorWithProspectiveState(
			fixture.map,
			fixture.portEquipment,
			fixture.patchSequence,
			organizations,
			{
				version: STATIC_FAB_ASSEMBLY_CONNECTOR_VERSION,
				purpose: "HIERARCHY_LINK",
				sourceOrganizationId: source.id,
				sourceGatewayId: sourceGateway.id,
				sourceAnchor: sourceGateway.anchor,
				targetOrganizationId: target.id,
				targetGatewayId: targetGateway.id,
				targetAnchor: targetGateway.anchor,
				side: null,
			},
		);

		expect(result.plan).toMatchObject({
			valid: false,
			organizationMutations: [],
			assemblyConnector: { issueCode: "HIERARCHY_INVALID" },
		});
		expect(result.prospectiveState).toBeNull();
	});

	it("rejects conflicting direct FAB parents even when both Bays share one Bank", () => {
		const fixture = placeProductionBays([
			{ x: 0, y: 0 },
			{ x: 100, y: 0 },
			{ x: 200, y: 0 },
			{ x: 300, y: 0 },
			{ x: 400, y: 0 },
			{ x: 500, y: 0 },
		]);
		const [source, target, leftBankBay, rightBankBay, leftFabBay, rightFabBay] =
			fixture.organizations.records.filter((record) => record.kind === "BAY");
		if (!source || !target || !leftBankBay || !rightBankBay || !leftFabBay || !rightFabBay) {
			throw new Error("Expected six Production Bays.");
		}
		const sharedBankId = fixture.organizations.nextOrganizationId;
		const leftBankId = sharedBankId + 1;
		const rightBankId = leftBankId + 1;
		const leftFabId = rightBankId + 1;
		const rightFabId = leftFabId + 1;
		const organizations = withHierarchy(fixture.organizations, [
			withParents(source, [sharedBankId, leftFabId]),
			withParents(target, [sharedBankId, rightFabId]),
			withParents(leftBankBay, [leftBankId]),
			withParents(rightBankBay, [rightBankId]),
			areaWithMembership(sharedBankId, "Shared Bay Bank", mergeMembership(source, target), []),
			area(leftBankId, "Left Bay Bank", leftBankBay, [leftFabId]),
			area(rightBankId, "Right Bay Bank", rightBankBay, [rightFabId]),
			area(leftFabId, "Left Fab", leftFabBay, []),
			area(rightFabId, "Right Fab", rightFabBay, []),
		]);
		expect(
			staticFabOrganizationStateError(fixture.map, fixture.portEquipment, organizations),
		).toBeNull();
		expect(
			staticFabAssemblyConnectorHierarchyEligibility(organizations, source.id, target.id),
		).toMatchObject({ valid: false, issueCode: "HIERARCHY_INVALID" });

		const sourceGateway = discoverStaticFabAssemblyGateways(
			fixture.map,
			organizations,
			source.id,
		)[0];
		const targetGateway = discoverStaticFabAssemblyGateways(
			fixture.map,
			organizations,
			target.id,
		)[0];
		if (!sourceGateway || !targetGateway) throw new Error("Expected Assembly gateways.");
		const result = planStaticFabAssemblyConnectorWithProspectiveState(
			fixture.map,
			fixture.portEquipment,
			fixture.patchSequence,
			organizations,
			{
				version: STATIC_FAB_ASSEMBLY_CONNECTOR_VERSION,
				purpose: "HIERARCHY_LINK",
				sourceOrganizationId: source.id,
				sourceGatewayId: sourceGateway.id,
				sourceAnchor: sourceGateway.anchor,
				targetOrganizationId: target.id,
				targetGatewayId: targetGateway.id,
				targetAnchor: targetGateway.anchor,
				side: null,
			},
		);
		expect(result.plan).toMatchObject({
			valid: false,
			organizationMutations: [],
			assemblyConnector: { issueCode: "HIERARCHY_INVALID" },
		});
		expect(result.prospectiveState).toBeNull();
	});

	it("rejects a conflicting direct FAB parent on either existing-Bank endpoint", () => {
		const fixture = placeProductionBays([
			{ x: 0, y: 0 },
			{ x: 100, y: 0 },
			{ x: 200, y: 0 },
			{ x: 300, y: 0 },
			{ x: 400, y: 0 },
			{ x: 500, y: 0 },
		]);
		const [bankBay, detachedBay, bankMembershipBay, fabMembershipBay, otherBankBay, otherFabBay] =
			fixture.organizations.records.filter((record) => record.kind === "BAY");
		if (
			!bankBay ||
			!detachedBay ||
			!bankMembershipBay ||
			!fabMembershipBay ||
			!otherBankBay ||
			!otherFabBay
		) {
			throw new Error("Expected six Production Bays.");
		}
		const bankId = fixture.organizations.nextOrganizationId;
		const otherBankId = bankId + 1;
		const fabId = otherBankId + 1;
		const otherFabId = fabId + 1;
		const organizations = withHierarchy(fixture.organizations, [
			withParents(bankBay, [bankId, otherFabId]),
			withParents(detachedBay, [fabId]),
			withParents(bankMembershipBay, [bankId]),
			withParents(otherBankBay, [otherBankId]),
			area(bankId, "Bay Bank", bankMembershipBay, [fabId]),
			area(otherBankId, "Other Bay Bank", otherBankBay, [otherFabId]),
			area(fabId, "Fab", fabMembershipBay, []),
			area(otherFabId, "Other Fab", otherFabBay, []),
		]);
		expect(
			staticFabOrganizationStateError(fixture.map, fixture.portEquipment, organizations),
		).toBeNull();
		for (const [sourceId, targetId] of [
			[bankBay.id, detachedBay.id],
			[detachedBay.id, bankBay.id],
		] as const) {
			expect(
				staticFabAssemblyConnectorHierarchyEligibility(organizations, sourceId, targetId),
			).toMatchObject({ valid: false, issueCode: "HIERARCHY_INVALID" });
		}

		const sourceGateway = discoverStaticFabAssemblyGateways(
			fixture.map,
			organizations,
			bankBay.id,
		)[0];
		const targetGateway = discoverStaticFabAssemblyGateways(
			fixture.map,
			organizations,
			detachedBay.id,
		)[0];
		if (!sourceGateway || !targetGateway) throw new Error("Expected Assembly gateways.");
		const result = planStaticFabAssemblyConnectorWithProspectiveState(
			fixture.map,
			fixture.portEquipment,
			fixture.patchSequence,
			organizations,
			{
				version: STATIC_FAB_ASSEMBLY_CONNECTOR_VERSION,
				purpose: "HIERARCHY_LINK",
				sourceOrganizationId: bankBay.id,
				sourceGatewayId: sourceGateway.id,
				sourceAnchor: sourceGateway.anchor,
				targetOrganizationId: detachedBay.id,
				targetGatewayId: targetGateway.id,
				targetAnchor: targetGateway.anchor,
				side: null,
			},
		);
		expect(result.plan).toMatchObject({
			valid: false,
			organizationMutations: [],
			assemblyConnector: { issueCode: "HIERARCHY_INVALID" },
		});
		expect(result.prospectiveState).toBeNull();
	});

	it("returns a bounded rejection instead of throwing for a malformed intent", () => {
		const fixture = placeProductionBays([{ x: 0, y: 0 }]);
		const malformed = {
			version: STATIC_FAB_ASSEMBLY_CONNECTOR_VERSION,
			purpose: "HIERARCHY_LINK",
			sourceOrganizationId: 1,
			sourceGatewayId: "source",
			sourceAnchor: null,
			targetOrganizationId: 2,
			targetGatewayId: "target",
			targetAnchor: { x: Number.NaN, y: 0 },
			side: "up",
		} as unknown as StaticFabAssemblyConnectorIntent;
		const result = planStaticFabAssemblyConnectorWithProspectiveState(
			fixture.map,
			fixture.portEquipment,
			fixture.patchSequence,
			fixture.organizations,
			malformed,
		);

		expect(result.plan).toMatchObject({
			valid: false,
			mutations: [],
			organizationMutations: [],
			assemblyConnector: { issueCode: "INVALID_SOURCE" },
		});
		expect(result.prospectiveState).toBeNull();
	});
});

function withHierarchy(
	state: StaticFabOrganizationState,
	replacementsAndAdditions: readonly StaticFabOrganizationRecord[],
): StaticFabOrganizationState {
	const records = new Map(state.records.map((record) => [record.id, record]));
	for (const record of replacementsAndAdditions) records.set(record.id, record);
	const highestId = Math.max(...records.keys());
	return Object.freeze({
		nextOrganizationId: highestId + 1,
		records: Object.freeze([...records.values()].sort((left, right) => left.id - right.id)),
	});
}

function withParents(
	record: StaticFabOrganizationRecord,
	parentOrganizationIds: readonly number[],
): StaticFabOrganizationRecord {
	return copyStaticFabOrganizationRecord({ ...record, parentOrganizationIds });
}

function area(
	id: number,
	name: string,
	membershipSource: StaticFabOrganizationRecord,
	parentOrganizationIds: readonly number[],
): StaticFabOrganizationRecord {
	return copyStaticFabOrganizationRecord({
		id,
		kind: "AREA",
		name,
		parentOrganizationIds,
		properties: { description: "Synthetic hierarchy fixture", color: "TEAL" },
		membership: membershipSource.membership,
	});
}

function areaWithMembership(
	id: number,
	name: string,
	membership: StaticFabOrganizationRecord["membership"],
	parentOrganizationIds: readonly number[],
): StaticFabOrganizationRecord {
	return copyStaticFabOrganizationRecord({
		id,
		kind: "AREA",
		name,
		parentOrganizationIds,
		properties: { description: "Synthetic hierarchy fixture", color: "TEAL" },
		membership,
	});
}

function mergeMembership(
	left: StaticFabOrganizationRecord,
	right: StaticFabOrganizationRecord,
): StaticFabOrganizationRecord["membership"] {
	const railEdges = new Map<string, (typeof left.membership.railEdges)[number]>();
	for (const edge of [...left.membership.railEdges, ...right.membership.railEdges]) {
		railEdges.set(`${edge.from.x}:${edge.from.y}:${edge.to.x}:${edge.to.y}`, edge);
	}
	return Object.freeze({
		railEdges: Object.freeze([...railEdges.values()].sort(compareDirectedRailEdges)),
		advancedSwitchIds: Object.freeze([
			...new Set([...left.membership.advancedSwitchIds, ...right.membership.advancedSwitchIds]),
		]),
		equipmentGroupIds: Object.freeze([
			...new Set([...left.membership.equipmentGroupIds, ...right.membership.equipmentGroupIds]),
		]),
	});
}

function placeProductionBays(anchors: readonly Readonly<{ x: number; y: number }>[]): FixtureState {
	const artifact = certifyProductionBayModuleCatalogRequest(
		defaultProductionBayModuleCatalogRequest("single-production-bay"),
	);
	let fixture: FixtureState = {
		relationships: emptyStaticFabAssemblyRelationshipState(),
		map: new TileMap(),
		portEquipment: emptyPortEquipmentState(),
		organizations: emptyStaticFabOrganizationState(),
		patchSequence: 0,
	};
	for (const anchor of anchors) {
		const placement = planStaticFabOrganizationBundlePlacementWithProspectiveState(
			fixture.map,
			fixture.portEquipment,
			fixture.patchSequence,
			fixture.organizations,
			fixture.relationships,
			artifact.organizationBundle,
			anchor,
			0,
			null,
		);
		if (!placement.plan.valid || !placement.prospectiveState) {
			throw new Error(placement.plan.reason);
		}
		fixture = {
			...placement.prospectiveState,
			patchSequence: fixture.patchSequence + 1,
		};
	}
	return fixture;
}

function firstValidConnector(
	fixture: FixtureState,
	sourceOrganizationId: number,
	targetOrganizationId: number,
): StaticFabAssemblyConnectorPlanningResult {
	const roles = deriveStaticFabOrganizationSemanticRoles(fixture.organizations);
	const eligibility =
		roles.get(sourceOrganizationId) === "BAY_BANK" && roles.get(targetOrganizationId) === "BAY_BANK"
			? staticFabAssemblyInterbayConnectorHierarchyEligibility(
					fixture.organizations,
					sourceOrganizationId,
					targetOrganizationId,
				)
			: staticFabAssemblyConnectorHierarchyEligibility(
					fixture.organizations,
					sourceOrganizationId,
					targetOrganizationId,
				);
	const purpose = eligibility.valid ? eligibility.purpose : "HIERARCHY_LINK";
	const discoverGateways =
		purpose === "FAB_LOOP"
			? discoverStaticFabOuterCirculationGateways
			: discoverStaticFabAssemblyGateways;
	const sources = discoverGateways(fixture.map, fixture.organizations, sourceOrganizationId);
	const targets = discoverGateways(fixture.map, fixture.organizations, targetOrganizationId);
	let last: StaticFabAssemblyConnectorPlanningResult | null = null;
	const failureReasons = new Set<string>();
	for (const source of sources) {
		for (const target of targets) {
			for (const side of [null, "left", "right"] as const) {
				last = planStaticFabAssemblyConnectorWithProspectiveState(
					fixture.map,
					fixture.portEquipment,
					fixture.patchSequence,
					fixture.organizations,
					{
						version: STATIC_FAB_ASSEMBLY_CONNECTOR_VERSION,
						purpose,
						sourceOrganizationId,
						sourceGatewayId: source.id,
						sourceAnchor: source.anchor,
						targetOrganizationId,
						targetGatewayId: target.id,
						targetAnchor: target.anchor,
						side,
					},
				);
				if (last.plan.valid) return last;
				failureReasons.add(last.plan.reason);
			}
		}
	}
	throw new Error(
		failureReasons.size > 0
			? [...failureReasons].join(" | ")
			: (last?.plan.reason ?? "No Assembly Connector gateway pair was found."),
	);
}
