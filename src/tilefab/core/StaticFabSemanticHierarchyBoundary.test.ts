import { describe, expect, it } from "vitest";
import {
	certifyProductionBayModuleCatalogRequest,
	defaultProductionBayModuleCatalogRequest,
} from "../compile/ProductionBayModuleCatalog";
import {
	reviewStaticFabSemanticBankDetachPostCutOwner,
	reviewStaticFabSemanticBankDetachProspective,
	STATIC_FAB_SEMANTIC_BANK_DETACH_PROSPECTIVE_MAX_POST_CUT_MODULES,
	type StaticFabSemanticBankDetachProspectiveReview,
	staticFabSemanticBankDetachPostCutModuleBudgetError,
} from "../compile/StaticFabSemanticBankDetachProspective";
import {
	copyPortEquipmentState,
	emptyPortEquipmentState,
	type PortEquipmentState,
} from "./EquipmentGroup";
import type { CardinalPortRoute, PortRecord } from "./PortRecord";
import { planRailPath } from "./paint";
import { buildRailModuleOwnershipIndex } from "./RailModuleOwnership";
import { ALL_DIRECTIONS, type Direction, moveCell } from "./railShape";
import {
	discoverStaticFabAssemblyGateways,
	discoverStaticFabOuterCirculationGateways,
	planStaticFabAssemblyConnectorWithProspectiveState,
	STATIC_FAB_ASSEMBLY_CONNECTOR_VERSION,
	type StaticFabAssemblyConnectorPlanningResult,
	staticFabAssemblyConnectorHierarchyEligibility,
	staticFabAssemblyInterbayConnectorHierarchyEligibility,
} from "./StaticFabAssemblyConnector";
import {
	compareDirectedRailEdges,
	copyStaticFabOrganizationRecord,
	copyStaticFabOrganizationState,
	deriveStaticFabOrganizationSemanticRoles,
	emptyStaticFabOrganizationState,
	type StaticFabOrganizationMembership,
	type StaticFabOrganizationRecord,
	type StaticFabOrganizationState,
	staticFabOrganizationEdgeKey,
	staticFabOrganizationParentIds,
} from "./StaticFabOrganization";
import {
	planStaticFabOrganizationBundlePlacementWithProspectiveState,
	type StaticFabOrganizationBundlePlacementProspectiveState,
} from "./StaticFabOrganizationBundlePlacement";
import {
	inventoryStaticFabSemanticHierarchyBoundary,
	STATIC_FAB_SEMANTIC_HIERARCHY_BOUNDARY_MAX_PORTS,
} from "./StaticFabSemanticHierarchyBoundary";
import {
	reviewStaticFabSemanticHierarchyCut,
	STATIC_FAB_SEMANTIC_HIERARCHY_CUT_SIBLING_ID_SAMPLE_LIMIT,
} from "./StaticFabSemanticHierarchyCut";
import {
	reviewStaticFabSemanticHierarchyRecovery,
	STATIC_FAB_SEMANTIC_HIERARCHY_RECOVERY_VERSION,
	type StaticFabSemanticHierarchyRecoveryIntent,
} from "./StaticFabSemanticHierarchyRecovery";
import { TileMap } from "./TileMap";

interface FixtureState extends StaticFabOrganizationBundlePlacementProspectiveState {
	readonly patchSequence: number;
}

describe("StaticFabSemanticHierarchyBoundary", () => {
	it("enumerates deterministic native-reopen raw shared-vertex parent components without mutation authority", () => {
		const fixture = reopenedConnectedFabFixture();
		const roles = deriveStaticFabOrganizationSemanticRoles(fixture.organizations);
		const bank = fixture.organizations.records.find(
			(record) => roles.get(record.id) === "BAY_BANK",
		);
		const fab = fixture.organizations.records.find((record) => roles.get(record.id) === "FAB");
		if (!bank || !fab) throw new Error("Expected one connected Fab fixture.");
		const intent = hierarchyIntent("DETACH", "BAY_BANK", bank.id, fab.id);
		const review = reviewStaticFabSemanticHierarchyRecovery(fixture.organizations, intent);

		const first = inventoryStaticFabSemanticHierarchyBoundary(
			fixture.map,
			fixture.portEquipment,
			fixture.organizations,
			intent,
			review,
		);
		const second = inventoryStaticFabSemanticHierarchyBoundary(
			fixture.map,
			fixture.portEquipment,
			fixture.organizations,
			intent,
			review,
		);

		expect(first).toEqual(second);
		expect(first).toMatchObject({
			candidateInventoryBuilt: true,
			issueCode: null,
			action: "DETACH",
			targetRole: "BAY_BANK",
			targetOrganizationId: bank.id,
			parentFabOrganizationId: fab.id,
			authority: "NO_MUTATION_AUTHORITY",
			evidenceStatus: "RAW_SHARED_VERTEX_COMPONENTS_ONLY",
			cutSetStatus: "CUT_SET_UNRESOLVED",
		});
		expect(first.unreviewedConditions).toEqual(
			expect.arrayContaining([
				"RELATIONSHIP_PURPOSE_UNRESOLVED",
				"OPPOSITE_ENDPOINT_UNRESOLVED",
				"DIRECTED_SEAM_UNREVIEWED",
				"COMPLETE_CUT_SET_UNRESOLVED",
			]),
		);
		expect(first.targetEffectiveModuleIndices.length).toBeGreaterThan(0);
		expect(first.parentDirectModuleIndices.length).toBeGreaterThan(0);
		expect(first.incidentParentModuleIndices.length).toBeGreaterThan(0);
		expect(first.rawSharedVertexContactCount).toBeGreaterThan(0);
		expect(first.candidateComponentDirectedEdgeCount).toBeGreaterThan(0);
		expect(first.rawParentComponentCandidates.length).toBeGreaterThan(1);
		expect(first.targetEffectiveModuleKeys).not.toContain(
			expect.stringMatching(/^UNRESOLVED_MODULE_/),
		);
		expect(first.parentDirectModuleKeys).not.toContain(
			expect.stringMatching(/^UNRESOLVED_MODULE_/),
		);
		expect(first.targetEffectiveModuleIndices).toEqual(
			[...first.targetEffectiveModuleIndices].sort((left, right) => left - right),
		);
		expect(first.parentDirectModuleIndices).toEqual(
			[...first.parentDirectModuleIndices].sort((left, right) => left - right),
		);
		expect(Object.isFrozen(first)).toBe(true);
		expect(Object.isFrozen(first.rawParentComponentCandidates)).toBe(true);
		expect(Object.isFrozen(first.rawParentComponentCandidates[0])).toBe(true);
		expect(Object.isFrozen(first.rawParentComponentCandidates[0]?.rawSharedVertexContacts)).toBe(
			true,
		);
	});

	it("keeps a middle Bank's 3-Bank contacts as raw pairs instead of terminal or corridor claims", () => {
		const fixture = reopenedThreeBankFabFixture();
		const roles = deriveStaticFabOrganizationSemanticRoles(fixture.organizations);
		const banks = fixture.organizations.records.filter(
			(record) => roles.get(record.id) === "BAY_BANK",
		);
		const fab = fixture.organizations.records.find((record) => roles.get(record.id) === "FAB");
		const middleBank = banks[1];
		if (!middleBank || !fab) throw new Error("Expected a three-Bank Fab fixture.");
		const intent = hierarchyIntent("DETACH", "BAY_BANK", middleBank.id, fab.id);
		const review = reviewStaticFabSemanticHierarchyRecovery(fixture.organizations, intent);
		const inventory = inventoryStaticFabSemanticHierarchyBoundary(
			fixture.map,
			fixture.portEquipment,
			fixture.organizations,
			intent,
			review,
		);

		expect(middleBank.id).toBe(14);
		expect(fab.id).toBe(16);
		expect(inventory).toMatchObject({
			candidateInventoryBuilt: true,
			rawSharedVertexContactCount: 7,
			candidateComponentDirectedEdgeCount: 1_438,
			authority: "NO_MUTATION_AUTHORITY",
			evidenceStatus: "RAW_SHARED_VERTEX_COMPONENTS_ONLY",
			cutSetStatus: "CUT_SET_UNRESOLVED",
		});
		expect(inventory.parentDirectModuleIndices).toHaveLength(314);
		expect(inventory.incidentParentModuleIndices).toHaveLength(6);
		expect(inventory.rawParentComponentCandidates).toHaveLength(6);
		expect(
			inventory.rawParentComponentCandidates
				.map((candidate) => [candidate.parentModuleIndices.length, candidate.directedEdgeCount])
				.sort((left, right) => left[0] - right[0] || left[1] - right[1]),
		).toEqual([
			[43, 190],
			[43, 190],
			[46, 212],
			[46, 212],
			[68, 317],
			[68, 317],
		]);
		expect(inventory.rawSharedVertexContactCount).toBeGreaterThan(
			inventory.rawParentComponentCandidates.length,
		);
	});

	it("rejects nonaccepted, mismatched, and stale source reviews", () => {
		const fixture = reopenedConnectedFabFixture();
		const { bank, fab } = selectedBankAndFab(fixture.organizations);
		const detachIntent = hierarchyIntent("DETACH", "BAY_BANK", bank.id, fab.id);
		const deleteIntent = hierarchyIntent("DELETE", "BAY_BANK", bank.id, fab.id);
		const detachReview = reviewStaticFabSemanticHierarchyRecovery(
			fixture.organizations,
			detachIntent,
		);
		const nonaccepted = reviewStaticFabSemanticHierarchyRecovery(
			fixture.organizations,
			hierarchyIntent("DETACH", "FAB", fab.id, null),
		);

		expect(
			inventoryStaticFabSemanticHierarchyBoundary(
				fixture.map,
				fixture.portEquipment,
				fixture.organizations,
				detachIntent,
				nonaccepted,
			),
		).toMatchObject({ candidateInventoryBuilt: false, issueCode: "NON_ACCEPTED_REVIEW" });
		expect(
			inventoryStaticFabSemanticHierarchyBoundary(
				fixture.map,
				fixture.portEquipment,
				fixture.organizations,
				deleteIntent,
				detachReview,
			),
		).toMatchObject({
			candidateInventoryBuilt: false,
			issueCode: "REVIEW_INTENT_MISMATCH",
		});

		const detachedOrganizations = replaceOrganization(fixture.organizations, {
			...bank,
			parentOrganizationIds: [],
		});
		expect(
			inventoryStaticFabSemanticHierarchyBoundary(
				fixture.map,
				fixture.portEquipment,
				detachedOrganizations,
				detachIntent,
				detachReview,
			),
		).toMatchObject({ candidateInventoryBuilt: false, issueCode: "STALE_REVIEW" });
	});

	it("does not treat detached Banks or root Fabs as a relationship boundary", () => {
		const detached = detachedBanksFixture();
		const roles = deriveStaticFabOrganizationSemanticRoles(detached.organizations);
		const bank = detached.organizations.records.find(
			(record) => roles.get(record.id) === "BAY_BANK",
		);
		if (!bank) throw new Error("Expected a detached Bank.");
		const bankIntent = hierarchyIntent("DELETE", "BAY_BANK", bank.id, null);
		const bankReview = reviewStaticFabSemanticHierarchyRecovery(detached.organizations, bankIntent);
		expect(
			inventoryStaticFabSemanticHierarchyBoundary(
				detached.map,
				detached.portEquipment,
				detached.organizations,
				bankIntent,
				bankReview,
			),
		).toMatchObject({
			candidateInventoryBuilt: false,
			issueCode: "UNSUPPORTED_TARGET",
			authority: "NO_MUTATION_AUTHORITY",
		});

		const connected = connectedFabFixture();
		const connectedRoles = deriveStaticFabOrganizationSemanticRoles(connected.organizations);
		const fab = connected.organizations.records.find(
			(record) => connectedRoles.get(record.id) === "FAB",
		);
		if (!fab) throw new Error("Expected a root Fab.");
		const fabIntent = hierarchyIntent("DELETE", "FAB", fab.id, null);
		const fabReview = reviewStaticFabSemanticHierarchyRecovery(connected.organizations, fabIntent);
		expect(
			inventoryStaticFabSemanticHierarchyBoundary(
				connected.map,
				connected.portEquipment,
				connected.organizations,
				fabIntent,
				fabReview,
			),
		).toMatchObject({ candidateInventoryBuilt: false, issueCode: "UNSUPPORTED_TARGET" });
	});

	it("fails closed on invalid Port state and explicit source budget overflow", () => {
		const fixture = reopenedConnectedFabFixture();
		const { bank, fab } = selectedBankAndFab(fixture.organizations);
		const intent = hierarchyIntent("DELETE", "BAY_BANK", bank.id, fab.id);
		const review = reviewStaticFabSemanticHierarchyRecovery(fixture.organizations, intent);
		const invalidPortState = {
			...fixture.portEquipment,
			nextPortId: 0,
		} as PortEquipmentState;
		expect(
			inventoryStaticFabSemanticHierarchyBoundary(
				fixture.map,
				invalidPortState,
				fixture.organizations,
				intent,
				review,
			),
		).toMatchObject({ candidateInventoryBuilt: false, issueCode: "INVALID_SOURCE" });

		const oversizedPortState = {
			...fixture.portEquipment,
			ports: new Array(STATIC_FAB_SEMANTIC_HIERARCHY_BOUNDARY_MAX_PORTS + 1),
		} as PortEquipmentState;
		expect(
			inventoryStaticFabSemanticHierarchyBoundary(
				fixture.map,
				oversizedPortState,
				fixture.organizations,
				intent,
				review,
			),
		).toMatchObject({
			candidateInventoryBuilt: false,
			issueCode: "SOURCE_BUDGET_EXCEEDED",
			authority: "NO_MUTATION_AUTHORITY",
		});
	});

	it("rejects invalid partial and cross-owner current sources before candidate indexing", () => {
		const fixture = reopenedConnectedFabFixture();
		const { bank, fab } = selectedBankAndFab(fixture.organizations);
		const intent = hierarchyIntent("DETACH", "BAY_BANK", bank.id, fab.id);
		const review = reviewStaticFabSemanticHierarchyRecovery(fixture.organizations, intent);
		const partialMembership = {
			...bank.membership,
			railEdges: bank.membership.railEdges.slice(1),
		};
		const partial = replaceOrganization(fixture.organizations, {
			...bank,
			membership: partialMembership,
		});
		expect(
			inventoryStaticFabSemanticHierarchyBoundary(
				fixture.map,
				fixture.portEquipment,
				partial,
				intent,
				review,
			),
		).toMatchObject({
			candidateInventoryBuilt: false,
			issueCode: "INVALID_SOURCE",
		});

		const selectedModuleMembership = firstWholeModuleMembership(fixture, bank);
		const sharedParent = replaceOrganization(fixture.organizations, {
			...fab,
			membership: mergeMembership(fab.membership, selectedModuleMembership),
		});
		expect(
			inventoryStaticFabSemanticHierarchyBoundary(
				fixture.map,
				fixture.portEquipment,
				sharedParent,
				intent,
				review,
			),
		).toMatchObject({
			candidateInventoryBuilt: false,
			issueCode: "INVALID_SOURCE",
		});
	});
});

describe("StaticFabSemanticHierarchyCut", () => {
	it("proves the two structural corridors of a hierarchy-only Fab but still grants no removal authority", () => {
		const fixture = hierarchyOnlyConnectedFabFixture();
		const { bank, fab } = selectedBankAndFab(fixture.organizations);
		const intent = hierarchyIntent("DETACH", "BAY_BANK", bank.id, fab.id);
		const hierarchyReview = reviewStaticFabSemanticHierarchyRecovery(fixture.organizations, intent);
		const cut = reviewStaticFabSemanticHierarchyCut(
			fixture.map,
			fixture.portEquipment,
			fixture.organizations,
			intent,
			hierarchyReview,
		);

		expect(cut).toMatchObject({
			structuralCutProved: true,
			corridorCount: 2,
			directedEdgeCount: 602,
			authority: "NO_MUTATION_AUTHORITY",
			prospectiveStatus: "NOT_EVALUATED",
		});
		expect(cut.corridors.map((corridor) => corridor.orientation).sort()).toEqual([
			"SELECTED_TO_SIBLING",
			"SIBLING_TO_SELECTED",
		]);
	});

	it("proves all four native-reopen structural corridors without inferring Connector purpose", () => {
		const liveFixture = connectedFabFixture();
		const fixture = reopenFixture(liveFixture, true);
		const { bank, fab } = selectedBankAndFab(fixture.organizations);
		const sibling = fixture.organizations.records.find(
			(record) =>
				record.id !== bank.id &&
				deriveStaticFabOrganizationSemanticRoles(fixture.organizations).get(record.id) ===
					"BAY_BANK",
		);
		if (!sibling) throw new Error("Expected one retained sibling Bank.");
		const intent = hierarchyIntent("DETACH", "BAY_BANK", bank.id, fab.id);
		const hierarchyReview = reviewStaticFabSemanticHierarchyRecovery(fixture.organizations, intent);

		const first = reviewStaticFabSemanticHierarchyCut(
			fixture.map,
			fixture.portEquipment,
			fixture.organizations,
			intent,
			hierarchyReview,
		);
		const second = reviewStaticFabSemanticHierarchyCut(
			fixture.map,
			fixture.portEquipment,
			fixture.organizations,
			intent,
			hierarchyReview,
		);
		const liveHierarchyReview = reviewStaticFabSemanticHierarchyRecovery(
			liveFixture.organizations,
			intent,
		);
		const live = reviewStaticFabSemanticHierarchyCut(
			liveFixture.map,
			liveFixture.portEquipment,
			liveFixture.organizations,
			intent,
			liveHierarchyReview,
		);

		expect(first).toEqual(second);
		expect(first.completeCutFingerprint).toBe(live.completeCutFingerprint);
		expect(first.corridors).toEqual(live.corridors);
		expect(first).toMatchObject({
			structuralCutProved: true,
			issueCode: null,
			boundaryIssueCode: null,
			corridorCount: 4,
			directedEdgeCount: 1_204,
			authority: "NO_MUTATION_AUTHORITY",
			evidenceStatus: "STRUCTURAL_RELATIONSHIP_CORRIDORS_ONLY",
			cutSetStatus: "STRUCTURAL_COMPLETE_CUT",
			prospectiveStatus: "NOT_EVALUATED",
		});
		expect(first.retainedSiblingBankOrganizationIdSample).toEqual([sibling.id]);
		expect(first.retainedSiblingBankOrganizationCount).toBe(1);
		expect(first.retainedSiblingBankOrganizationOmittedCount).toBe(0);
		expect(first.retainedSiblingBankOrganizationFingerprint).toMatch(/^[0-9a-f]{8}:[0-9a-f]{8}$/);
		expect(first.corridors.map((corridor) => corridor.oppositeBankOrganizationId)).toEqual([
			sibling.id,
			sibling.id,
			sibling.id,
			sibling.id,
		]);
		expect(
			first.corridors.filter((corridor) => corridor.orientation === "SELECTED_TO_SIBLING"),
		).toHaveLength(2);
		expect(
			first.corridors.filter((corridor) => corridor.orientation === "SIBLING_TO_SELECTED"),
		).toHaveLength(2);
		expect(first.unreviewedConditions).toContain("RELATIONSHIP_PURPOSE_UNRESOLVED");
		expect(first.unreviewedConditions).toContain("PROSPECTIVE_RETAINED_FAB_TOPOLOGY_UNREVIEWED");
		expect(first.completeCutFingerprint).toMatch(/^[0-9a-f]{8}:[0-9a-f]{8}$/);
		expect(Object.isFrozen(first)).toBe(true);
		expect(Object.isFrozen(first.corridors)).toBe(true);
		expect(Object.isFrozen(first.corridors[0]?.directedEdgeKeys)).toBe(true);
		expect(first).not.toHaveProperty("mutations");
		expect(first).not.toHaveProperty("organizationMutations");
		expect(first).not.toHaveProperty("prospectiveState");
	});

	it("resolves a middle Bank's six corridors to both exact retained sibling Banks", () => {
		const fixture = reopenedThreeBankFabFixture();
		const roles = deriveStaticFabOrganizationSemanticRoles(fixture.organizations);
		const banks = fixture.organizations.records.filter(
			(record) => roles.get(record.id) === "BAY_BANK",
		);
		const fab = fixture.organizations.records.find((record) => roles.get(record.id) === "FAB");
		const middleBank = banks[1];
		if (!middleBank || !fab) throw new Error("Expected a three-Bank Fab fixture.");
		const intent = hierarchyIntent("DETACH", "BAY_BANK", middleBank.id, fab.id);
		const hierarchyReview = reviewStaticFabSemanticHierarchyRecovery(fixture.organizations, intent);
		const cut = reviewStaticFabSemanticHierarchyCut(
			fixture.map,
			fixture.portEquipment,
			fixture.organizations,
			intent,
			hierarchyReview,
		);

		expect(cut).toMatchObject({
			structuralCutProved: true,
			corridorCount: 6,
			directedEdgeCount: 1_438,
			retainedSiblingBankOrganizationIdSample: [13, 15],
			retainedSiblingBankOrganizationCount: 2,
			retainedSiblingBankOrganizationOmittedCount: 0,
		});
		expect(
			Object.fromEntries(
				[13, 15].map((id) => [
					id,
					cut.corridors.filter((corridor) => corridor.oppositeBankOrganizationId === id).length,
				]),
			),
		).toEqual({ 13: 4, 15: 2 });
		expect(
			cut.corridors.filter((corridor) => corridor.orientation === "SELECTED_TO_SIBLING"),
		).toHaveLength(3);
		expect(
			cut.corridors.filter((corridor) => corridor.orientation === "SIBLING_TO_SELECTED"),
		).toHaveLength(3);
		expect(
			cut.corridors.map((corridor) => corridor.directedEdgeCount).sort((a, b) => a - b),
		).toEqual([190, 190, 212, 212, 317, 317]);
	});

	it("preserves the boundary rejection instead of promoting an invalid source to cut evidence", () => {
		const fixture = reopenedConnectedFabFixture();
		const { bank, fab } = selectedBankAndFab(fixture.organizations);
		const intent = hierarchyIntent("DELETE", "BAY_BANK", bank.id, fab.id);
		const hierarchyReview = reviewStaticFabSemanticHierarchyRecovery(fixture.organizations, intent);
		const invalidPortState = { ...fixture.portEquipment, nextPortId: 0 } as PortEquipmentState;

		expect(
			reviewStaticFabSemanticHierarchyCut(
				fixture.map,
				invalidPortState,
				fixture.organizations,
				intent,
				hierarchyReview,
			),
		).toMatchObject({
			structuralCutProved: false,
			issueCode: "BOUNDARY_INVENTORY_REJECTED",
			boundaryIssueCode: "INVALID_SOURCE",
			authority: "NO_MUTATION_AUTHORITY",
			corridorCount: 0,
		});
	});

	it("rejects a structurally attached path when no semantic sibling Bank remains under the Fab", () => {
		const fixture = reopenedConnectedFabFixture();
		const roles = deriveStaticFabOrganizationSemanticRoles(fixture.organizations);
		const banks = fixture.organizations.records.filter(
			(record) => roles.get(record.id) === "BAY_BANK",
		);
		const bank = banks[0];
		const sibling = banks[1];
		const fab = fixture.organizations.records.find((record) => roles.get(record.id) === "FAB");
		if (!bank || !sibling || !fab) throw new Error("Expected an attached two-Bank Fab.");
		const organizations = replaceOrganization(fixture.organizations, {
			...sibling,
			parentOrganizationIds: [],
		});
		const intent = hierarchyIntent("DETACH", "BAY_BANK", bank.id, fab.id);
		const hierarchyReview = reviewStaticFabSemanticHierarchyRecovery(organizations, intent);

		expect(
			reviewStaticFabSemanticHierarchyCut(
				fixture.map,
				fixture.portEquipment,
				organizations,
				intent,
				hierarchyReview,
			),
		).toMatchObject({
			structuralCutProved: false,
			issueCode: "MISSING_RETAINED_SIBLING",
			boundaryIssueCode: null,
			authority: "NO_MUTATION_AUTHORITY",
		});
	});

	it("rejects a wrong-tier record hidden below an otherwise recognizable retained sibling Bank", () => {
		const fixture = reopenedConnectedFabFixture();
		const roles = deriveStaticFabOrganizationSemanticRoles(fixture.organizations);
		const banks = fixture.organizations.records.filter(
			(record) => roles.get(record.id) === "BAY_BANK",
		);
		const bank = banks[0];
		const sibling = banks[1];
		const fab = fixture.organizations.records.find((record) => roles.get(record.id) === "FAB");
		const siblingBay = fixture.organizations.records.find(
			(record) =>
				roles.get(record.id) === "BAY" &&
				staticFabOrganizationParentIds(record).includes(sibling?.id ?? -1),
		);
		const processLoop = fixture.organizations.records.find(
			(record) =>
				roles.get(record.id) === "PROCESS_LOOP" &&
				staticFabOrganizationParentIds(record).includes(siblingBay?.id ?? -1),
		);
		if (!bank || !sibling || !fab || !siblingBay || !processLoop) {
			throw new Error("Expected a complete retained sibling Bank subtree.");
		}
		const organizations = replaceOrganization(fixture.organizations, {
			...processLoop,
			kind: "PROCESS_FAMILY",
		});
		const intent = hierarchyIntent("DETACH", "BAY_BANK", bank.id, fab.id);
		const hierarchyReview = reviewStaticFabSemanticHierarchyRecovery(organizations, intent);

		expect(
			reviewStaticFabSemanticHierarchyCut(
				fixture.map,
				fixture.portEquipment,
				organizations,
				intent,
				hierarchyReview,
			),
		).toMatchObject({
			structuralCutProved: false,
			issueCode: "NON_CANONICAL_RETAINED_SUBTREE",
			authority: "NO_MUTATION_AUTHORITY",
		});
	});

	it("bounds the retained sibling response while binding every omitted sibling in a fingerprint", () => {
		const fixture = hierarchyOnlyConnectedFabFixture();
		const { bank, fab } = selectedBankAndFab(fixture.organizations);
		const expanded = withSyntheticSiblingBanks(
			fixture,
			fab.id,
			STATIC_FAB_SEMANTIC_HIERARCHY_CUT_SIBLING_ID_SAMPLE_LIMIT + 1,
		);
		const intent = hierarchyIntent("DETACH", "BAY_BANK", bank.id, fab.id);
		const hierarchyReview = reviewStaticFabSemanticHierarchyRecovery(
			expanded.organizations,
			intent,
		);
		const first = reviewStaticFabSemanticHierarchyCut(
			expanded.map,
			expanded.portEquipment,
			expanded.organizations,
			intent,
			hierarchyReview,
		);
		const second = reviewStaticFabSemanticHierarchyCut(
			expanded.map,
			expanded.portEquipment,
			expanded.organizations,
			intent,
			hierarchyReview,
		);

		expect(first.structuralCutProved).toBe(true);
		expect(first.retainedSiblingBankOrganizationCount).toBe(
			STATIC_FAB_SEMANTIC_HIERARCHY_CUT_SIBLING_ID_SAMPLE_LIMIT + 2,
		);
		expect(first.retainedSiblingBankOrganizationIdSample).toHaveLength(
			STATIC_FAB_SEMANTIC_HIERARCHY_CUT_SIBLING_ID_SAMPLE_LIMIT,
		);
		expect(first.retainedSiblingBankOrganizationOmittedCount).toBe(2);
		expect(first.retainedSiblingBankOrganizationFingerprint).toBe(
			second.retainedSiblingBankOrganizationFingerprint,
		);
		expect(Object.isFrozen(first.retainedSiblingBankOrganizationIdSample)).toBe(true);
	});

	it("rejects an otherwise valid parent corridor with one unowned internal branch incidence", () => {
		const fixture = reopenedConnectedFabFixture();
		const { bank, fab } = selectedBankAndFab(fixture.organizations);
		const intent = hierarchyIntent("DETACH", "BAY_BANK", bank.id, fab.id);
		const hierarchyReview = reviewStaticFabSemanticHierarchyRecovery(fixture.organizations, intent);
		const baseline = reviewStaticFabSemanticHierarchyCut(
			fixture.map,
			fixture.portEquipment,
			fixture.organizations,
			intent,
			hierarchyReview,
		);
		expect(baseline.structuralCutProved).toBe(true);
		const branchedMap = addUnownedInternalBranch(
			fixture.map,
			baseline.corridors[0]?.directedEdgeKeys ?? [],
		);

		expect(
			reviewStaticFabSemanticHierarchyCut(
				branchedMap,
				fixture.portEquipment,
				fixture.organizations,
				intent,
				hierarchyReview,
			),
		).toMatchObject({
			structuralCutProved: false,
			issueCode: "INVALID_DIRECTED_SEAM",
			boundaryIssueCode: null,
			cutSetStatus: "NOT_EVALUATED",
			authority: "NO_MUTATION_AUTHORITY",
		});
	});
});

describe("StaticFabSemanticBankDetachProspective", () => {
	it("fails closed when post-cut modules merge incompatible direct-owner claims", () => {
		const differentOwners = reviewStaticFabSemanticBankDetachPostCutOwner([
			new Set([7]),
			new Set([8]),
		]);
		const ownedAndUnowned = reviewStaticFabSemanticBankDetachPostCutOwner([
			new Set([7]),
			new Set(),
		]);
		const sameOwner = reviewStaticFabSemanticBankDetachPostCutOwner([
			new Set([7]),
			new Set([7]),
			new Set([7]),
		]);
		const whollyUnowned = reviewStaticFabSemanticBankDetachPostCutOwner([new Set(), new Set()]);

		for (const review of [differentOwners, ownedAndUnowned]) {
			expect(review).toMatchObject({
				status: "AMBIGUOUS",
				ownerId: null,
				issueCode: "AMBIGUOUS_POST_CUT_OWNERSHIP",
				authority: "NO_MUTATION_AUTHORITY",
			});
		}
		expect(sameOwner).toMatchObject({
			status: "EXACT_DIRECT_OWNER",
			ownerId: 7,
			issueCode: null,
			authority: "NO_MUTATION_AUTHORITY",
		});
		expect(whollyUnowned).toMatchObject({
			status: "WHOLLY_UNOWNED",
			ownerId: null,
			issueCode: null,
			authority: "NO_MUTATION_AUTHORITY",
		});
		expect(Object.isFrozen(sameOwner)).toBe(true);
	});

	it("fails closed at the exact post-cut module product budget", () => {
		expect(
			staticFabSemanticBankDetachPostCutModuleBudgetError(
				STATIC_FAB_SEMANTIC_BANK_DETACH_PROSPECTIVE_MAX_POST_CUT_MODULES,
			),
		).toBeNull();
		expect(
			staticFabSemanticBankDetachPostCutModuleBudgetError(
				STATIC_FAB_SEMANTIC_BANK_DETACH_PROSPECTIVE_MAX_POST_CUT_MODULES + 1,
			),
		).toContain("100,000");
		expect(staticFabSemanticBankDetachPostCutModuleBudgetError(-1)).not.toBeNull();
		expect(
			staticFabSemanticBankDetachPostCutModuleBudgetError(Number.MAX_SAFE_INTEGER + 1),
		).not.toBeNull();
	});

	it("rebuilds current source and rejects invalid Port truth before prospective evaluation", () => {
		const fixture = reopenedConnectedFabFixture();
		const { bank, fab } = selectedBankAndFab(fixture.organizations);
		const invalidPortState = { ...fixture.portEquipment, nextPortId: 0 } as PortEquipmentState;
		const review = reviewStaticFabSemanticBankDetachProspective(
			fixture.map,
			invalidPortState,
			fixture.organizations,
			hierarchyIntent("DETACH", "BAY_BANK", bank.id, fab.id),
		);

		expect(review).toMatchObject({
			prospectiveDetachProved: false,
			issueCode: "STRUCTURAL_CUT_REJECTED",
			structuralCutIssueCode: "BOUNDARY_INVENTORY_REJECTED",
			structuralCorridorCount: 0,
			removedDirectedEdgeCount: 0,
			portAttachmentStatus: "NOT_EVALUATED",
			cursorStatus: "NOT_EVALUATED",
			mutationPlanStatus: "UNREVIEWED",
			authority: "NO_MUTATION_AUTHORITY",
			sourcePortCount: 0,
			sourceEquipmentGroupCount: 0,
		});
		expectNoDetachAuthoritySurface(review);
	});

	it("does not reinterpret attached-Bank DELETE as prospective Detach authority", () => {
		const fixture = reopenFixture(hierarchyOnlyConnectedFabFixture());
		const { bank, fab } = selectedBankAndFab(fixture.organizations);
		const review = reviewStaticFabSemanticBankDetachProspective(
			fixture.map,
			fixture.portEquipment,
			fixture.organizations,
			hierarchyIntent("DELETE", "BAY_BANK", bank.id, fab.id),
		);

		expect(review).toMatchObject({
			prospectiveDetachProved: false,
			issueCode: "UNSUPPORTED_OPERATION",
			structuralCutIssueCode: null,
			structuralCorridorCount: 2,
			removedDirectedEdgeCount: 0,
			mutationPlanStatus: "UNREVIEWED",
			authority: "NO_MUTATION_AUTHORITY",
		});
		expectNoDetachAuthoritySurface(review);
	});

	it("rejects a hierarchy-only two-Bank detach when the complete cut empties the Fab record", () => {
		const fixture = reopenFixture(hierarchyOnlyConnectedFabFixture());
		const { bank, fab } = selectedBankAndFab(fixture.organizations);
		const review = reviewStaticFabSemanticBankDetachProspective(
			fixture.map,
			fixture.portEquipment,
			fixture.organizations,
			hierarchyIntent("DETACH", "BAY_BANK", bank.id, fab.id),
		);

		expect(review).toMatchObject({
			prospectiveDetachProved: false,
			issueCode: "RETAINED_FAB_DIRECT_MEMBERSHIP_EMPTY",
			structuralCorridorCount: 2,
			removedDirectedEdgeCount: 602,
			authoredComponentDelta: 1,
			physicalComponentDelta: 1,
			portAttachmentStatus: "VALID",
			cursorStatus: "PRESERVED",
			mutationPlanStatus: "UNREVIEWED",
			authority: "NO_MUTATION_AUTHORITY",
		});
		expectNoDetachAuthoritySurface(review);
	});

	it("rejects a two-Bank loop when exact cut removal would empty retained Fab direct membership", () => {
		const fixture = reopenedConnectedFabFixture();
		const { bank, fab } = selectedBankAndFab(fixture.organizations);
		const revision = fixture.map.getRevision();
		const generation = fixture.map.getMutationGeneration();
		const edgeCount = fixture.map.edgeCount;
		const review = reviewStaticFabSemanticBankDetachProspective(
			fixture.map,
			fixture.portEquipment,
			fixture.organizations,
			hierarchyIntent("DETACH", "BAY_BANK", bank.id, fab.id),
		);
		expect(review).toMatchObject({
			prospectiveDetachProved: false,
			issueCode: "RETAINED_FAB_DIRECT_MEMBERSHIP_EMPTY",
			structuralCorridorCount: 4,
			removedDirectedEdgeCount: 1_204,
			authoredComponentDelta: 1,
			physicalComponentDelta: 1,
			portAttachmentStatus: "VALID",
			cursorStatus: "PRESERVED",
			authority: "NO_MUTATION_AUTHORITY",
			relationshipPurposeStatus: "UNRESOLVED",
			connectorProvenanceStatus: "UNRESOLVED",
			mutationPlanStatus: "UNREVIEWED",
		});
		expect(review.selectedBankTopology).toMatchObject({ closed: true });
		expect(review.retainedFabTopology).toMatchObject({ closed: true });
		expect(fixture.map.getRevision()).toBe(revision);
		expect(fixture.map.getMutationGeneration()).toBe(generation);
		expect(fixture.map.edgeCount).toBe(edgeCount);
		expectNoDetachAuthoritySurface(review);
	});

	it("rejects a middle Bank when the retained Fab would split into two closed regions", () => {
		const fixture = reopenedThreeBankFabFixture();
		const roles = deriveStaticFabOrganizationSemanticRoles(fixture.organizations);
		const middleBank = fixture.organizations.records.find((record) => record.id === 14);
		const fab = fixture.organizations.records.find((record) => roles.get(record.id) === "FAB");
		if (!middleBank || !fab || roles.get(middleBank.id) !== "BAY_BANK") {
			throw new Error("Expected the middle Bank and root Fab fixture.");
		}
		const review = reviewStaticFabSemanticBankDetachProspective(
			fixture.map,
			fixture.portEquipment,
			fixture.organizations,
			hierarchyIntent("DETACH", "BAY_BANK", middleBank.id, fab.id),
		);

		expect(review).toMatchObject({
			prospectiveDetachProved: false,
			issueCode: "RETAINED_FAB_TOPOLOGY_INVALID",
			structuralCorridorCount: 6,
			removedDirectedEdgeCount: 1_438,
			authoredComponentDelta: 2,
			physicalComponentDelta: 2,
			portAttachmentStatus: "VALID",
			cursorStatus: "PRESERVED",
			authority: "NO_MUTATION_AUTHORITY",
			mutationPlanStatus: "UNREVIEWED",
		});
		expect(review.selectedBankTopology).toMatchObject({
			authoredComponentCount: 1,
			physicalComponentCount: 1,
			closed: true,
		});
		expect(review.retainedFabTopology).toMatchObject({
			authoredComponentCount: 2,
			authoredStrongComponentCount: 2,
			physicalComponentCount: 2,
			physicalStrongComponentCount: 2,
			completeModuleCoverage: true,
			closed: false,
		});
		expectNoDetachAuthoritySurface(review);
	});

	it("proves both end-Bank detach evaluations while preserving unresolved relationship meaning", () => {
		const source = threeBankFabFixture();
		const fixture = reopenFixture(source);
		const reverseFixture = reopenFixture(source, true);
		const roles = deriveStaticFabOrganizationSemanticRoles(fixture.organizations);
		const fab = fixture.organizations.records.find((record) => roles.get(record.id) === "FAB");
		if (!fab) throw new Error("Expected the three-Bank root Fab fixture.");

		for (const [bankId, corridorCount] of [
			[13, 4],
			[15, 2],
		] as const) {
			const review = reviewStaticFabSemanticBankDetachProspective(
				fixture.map,
				fixture.portEquipment,
				fixture.organizations,
				hierarchyIntent("DETACH", "BAY_BANK", bankId, fab.id),
			);
			const reverseReview = reviewStaticFabSemanticBankDetachProspective(
				reverseFixture.map,
				reverseFixture.portEquipment,
				reverseFixture.organizations,
				hierarchyIntent("DETACH", "BAY_BANK", bankId, fab.id),
			);

			expect(review, `reverse-insertion Bank ${bankId}`).toEqual(reverseReview);
			expect(review, `Bank ${bankId}`).toMatchObject({
				prospectiveDetachProved: true,
				issueCode: null,
				structuralCutIssueCode: null,
				structuralCorridorCount: corridorCount,
				authoredComponentDelta: 1,
				physicalComponentDelta: 1,
				portAttachmentStatus: "VALID",
				cursorStatus: "PRESERVED",
				authority: "NO_MUTATION_AUTHORITY",
				evidenceStatus: "PROSPECTIVE_BANK_DETACH_ONLY",
				relationshipPurposeStatus: "UNRESOLVED",
				connectorProvenanceStatus: "UNRESOLVED",
				mutationPlanStatus: "UNREVIEWED",
			});
			expect(review.selectedBankTopology, `selected Bank ${bankId}`).toMatchObject({
				authoredComponentCount: 1,
				authoredStrongComponentCount: 1,
				physicalComponentCount: 1,
				physicalStrongComponentCount: 1,
				completeModuleCoverage: true,
				closed: true,
			});
			expect(review.retainedFabTopology, `retained Fab after ${bankId}`).toMatchObject({
				authoredComponentCount: 1,
				authoredStrongComponentCount: 1,
				physicalComponentCount: 1,
				physicalStrongComponentCount: 1,
				completeModuleCoverage: true,
				closed: true,
			});
			expect(Object.isFrozen(review)).toBe(true);
			expect(Object.isFrozen(review.evaluatedTopology)).toBe(true);
			expectNoDetachAuthoritySurface(review);
		}
	});

	it("preserves real selected- and retained-side Port attachments without publishing state", () => {
		const fixture = reopenFixture(threeBankFabFixture());
		const roles = deriveStaticFabOrganizationSemanticRoles(fixture.organizations);
		const fab = fixture.organizations.records.find((record) => roles.get(record.id) === "FAB");
		const selectedBank = fixture.organizations.records.find((record) => record.id === 13);
		const retainedBank = fixture.organizations.records.find((record) => record.id === 15);
		if (!fab || !selectedBank || !retainedBank) {
			throw new Error("Expected end Banks and root Fab.");
		}
		const selectedRoute = regularCardinalRouteForMembership(
			fixture.map,
			selectedBank.membership.railEdges,
		);
		const retainedRoute = regularCardinalRouteForMembership(
			fixture.map,
			retainedBank.membership.railEdges,
		);
		const portEquipment = twoOhbPortEquipment(selectedRoute, retainedRoute);
		let organizations = attachEquipmentGroup(fixture.organizations, selectedBank.id, 1);
		organizations = attachEquipmentGroup(organizations, retainedBank.id, 2);
		const sourcePortEquipment = copyPortEquipmentState(portEquipment);
		const sourceOrganizations = copyStaticFabOrganizationState(organizations);

		const review = reviewStaticFabSemanticBankDetachProspective(
			fixture.map,
			portEquipment,
			organizations,
			hierarchyIntent("DETACH", "BAY_BANK", selectedBank.id, fab.id),
		);

		expect(review).toMatchObject({
			prospectiveDetachProved: true,
			issueCode: null,
			portAttachmentStatus: "VALID",
			cursorStatus: "PRESERVED",
			sourcePortCount: 2,
			sourceEquipmentGroupCount: 2,
			authority: "NO_MUTATION_AUTHORITY",
		});
		expect(portEquipment).toEqual(sourcePortEquipment);
		expect(organizations).toEqual(sourceOrganizations);
		expectNoDetachAuthoritySurface(review);
	});

	it("rejects a valid-shaped Port whose station is outside its compiled physical route", () => {
		const fixture = reopenFixture(threeBankFabFixture());
		const roles = deriveStaticFabOrganizationSemanticRoles(fixture.organizations);
		const fab = fixture.organizations.records.find((record) => roles.get(record.id) === "FAB");
		const selectedBank = fixture.organizations.records.find((record) => record.id === 13);
		if (!fab || !selectedBank) throw new Error("Expected selected end Bank and root Fab.");
		const route = regularCardinalRouteForMembership(fixture.map, selectedBank.membership.railEdges);
		const validState = twoOhbPortEquipment(route, route);
		const invalidPort = Object.freeze({
			...(validState.ports[0] as PortRecord),
			stationMillimeters: 100_000,
		});
		const portEquipment = copyPortEquipmentState({
			nextPortId: 2,
			nextEquipmentGroupId: 2,
			ports: [invalidPort],
			equipmentGroups: [{ id: 1, kind: "OHB", template: "SINGLE", portIds: [1] }],
		});
		const organizations = attachEquipmentGroup(fixture.organizations, selectedBank.id, 1);

		const review = reviewStaticFabSemanticBankDetachProspective(
			fixture.map,
			portEquipment,
			organizations,
			hierarchyIntent("DETACH", "BAY_BANK", selectedBank.id, fab.id),
		);

		expect(review).toMatchObject({
			prospectiveDetachProved: false,
			issueCode: "PORT_ATTACHMENT_INVALID",
			structuralCutIssueCode: null,
			portAttachmentStatus: "NOT_EVALUATED",
			sourcePortCount: 1,
			sourceEquipmentGroupCount: 1,
			authority: "NO_MUTATION_AUTHORITY",
		});
		expect(review.reason).toContain("physical attachment is invalid");
		expect(review.reason).toContain("STATION_OUT_OF_RANGE");
		expectNoDetachAuthoritySurface(review);
	});
});

function expectNoDetachAuthoritySurface(
	review: StaticFabSemanticBankDetachProspectiveReview,
): void {
	const forbiddenKeys = new Set([
		"mutations",
		"switchMutations",
		"portMutations",
		"equipmentGroupMutations",
		"organizationMutations",
		"organizationImpactAuthorizations",
		"prospectiveMap",
		"prospectiveState",
		"plan",
		"permit",
		"ticket",
		"commit",
		"apply",
		"Apply",
	]);
	const visited = new Set<object>();
	const visit = (value: unknown): void => {
		if (value === null || typeof value !== "object" || visited.has(value)) return;
		visited.add(value);
		for (const [key, child] of Object.entries(value)) {
			expect(forbiddenKeys.has(key), `forbidden authority field ${key}`).toBe(false);
			visit(child);
		}
	};
	visit(review);
	expect(review.mutationPlanStatus).toBe("UNREVIEWED");
	for (const key of forbiddenKeys) {
		expect(review).not.toHaveProperty(key);
	}
}

function addUnownedInternalBranch(map: TileMap, directedEdgeKeys: readonly string[]): TileMap {
	const branched = map.clone();
	const reasons = new Set<string>();
	for (const edgeKey of directedEdgeKeys.slice(4, -4)) {
		const from = parseDirectedEdgeStart(edgeKey);
		for (const direction of ALL_DIRECTIONS) {
			if ((branched.connectionMask(from.x, from.y) & direction) !== 0) continue;
			const target = moveCell(from, direction);
			const targetLead = moveCell(target, direction);
			if (branched.hasRail(target.x, target.y) || branched.hasRail(targetLead.x, targetLead.y)) {
				continue;
			}
			const plan = planRailPath(branched, [from, target, targetLead]);
			if (!plan.valid) {
				reasons.add(plan.reason);
				continue;
			}
			if (!branched.applyAtomicMutations(plan.mutations, plan.switchMutations ?? [])) continue;
			return branched;
		}
	}
	throw new Error(
		`Expected one legal unowned branch candidate inside a structural corridor · ${[...reasons].join(" | ")}`,
	);
}

function withSyntheticSiblingBanks(
	fixture: FixtureState,
	fabOrganizationId: number,
	count: number,
): FixtureState {
	const map = fixture.map.clone();
	const records = [...fixture.organizations.records];
	let nextId = fixture.organizations.nextOrganizationId;
	for (let index = 0; index < count; index += 1) {
		const bankId = nextId++;
		const bayId = nextId++;
		const loopId = nextId++;
		const memberships = [0, 1, 2].map((offset) => {
			const from = { x: 1_000 + index * 10, y: 500 + offset * 3 };
			const to = { x: from.x + 1, y: from.y };
			const plan = planRailPath(map, [from, to]);
			if (!plan.valid || !map.applyAtomicMutations(plan.mutations, plan.switchMutations ?? [])) {
				throw new Error(`Could not author synthetic sibling module ${index}:${offset}.`);
			}
			return singleEdgeMembership(from, to);
		});
		records.push(
			copyStaticFabOrganizationRecord({
				id: bankId,
				kind: "AREA",
				name: `Empty sibling Bank ${index + 1}`,
				parentOrganizationIds: [fabOrganizationId],
				membership: memberships[0] as StaticFabOrganizationMembership,
			}),
			copyStaticFabOrganizationRecord({
				id: bayId,
				kind: "BAY",
				name: `Empty sibling Bay ${index + 1}`,
				parentOrganizationIds: [bankId],
				membership: memberships[1] as StaticFabOrganizationMembership,
			}),
			copyStaticFabOrganizationRecord({
				id: loopId,
				kind: "AISLE",
				name: `Empty sibling Loop ${index + 1}`,
				parentOrganizationIds: [bayId],
				membership: memberships[2] as StaticFabOrganizationMembership,
			}),
		);
	}
	return Object.freeze({
		map,
		portEquipment: fixture.portEquipment,
		organizations: copyStaticFabOrganizationState({ nextOrganizationId: nextId, records }),
		patchSequence: fixture.patchSequence,
	});
}

function singleEdgeMembership(
	from: Readonly<{ x: number; y: number }>,
	to: Readonly<{ x: number; y: number }>,
): StaticFabOrganizationMembership {
	return Object.freeze({
		railEdges: Object.freeze([Object.freeze({ from: Object.freeze(from), to: Object.freeze(to) })]),
		advancedSwitchIds: Object.freeze([]),
		equipmentGroupIds: Object.freeze([]),
	});
}

function parseDirectedEdgeStart(edgeKey: string): Readonly<{ x: number; y: number }> {
	const separator = edgeKey.indexOf(">");
	const [x, y] = edgeKey.slice(0, separator).split(":").map(Number);
	return Object.freeze({ x: x as number, y: y as number });
}

function hierarchyIntent(
	action: "DETACH" | "DELETE",
	targetRole: "BAY_BANK" | "FAB",
	targetOrganizationId: number,
	expectedParentOrganizationId: number | null,
): StaticFabSemanticHierarchyRecoveryIntent {
	return Object.freeze({
		version: STATIC_FAB_SEMANTIC_HIERARCHY_RECOVERY_VERSION,
		action,
		targetRole,
		targetOrganizationId,
		expectedParentOrganizationId,
	});
}

function selectedBankAndFab(organizations: StaticFabOrganizationState): Readonly<{
	bank: StaticFabOrganizationRecord;
	fab: StaticFabOrganizationRecord;
}> {
	const roles = deriveStaticFabOrganizationSemanticRoles(organizations);
	const bank = organizations.records.find((record) => roles.get(record.id) === "BAY_BANK");
	const fab = organizations.records.find((record) => roles.get(record.id) === "FAB");
	if (!bank || !fab) throw new Error("Expected a connected semantic Bank and Fab.");
	return Object.freeze({ bank, fab });
}

function reopenedConnectedFabFixture(): FixtureState {
	return reopenFixture(connectedFabFixture());
}

function reopenFixture(source: FixtureState, reverseInsertion = false): FixtureState {
	const hydrator = TileMap.createHydrator();
	const cells: Array<readonly [number, number, number]> = [];
	source.map.forEachRail((x, y, _rail, encoded) => cells.push([x, y, encoded]));
	const switches: Parameters<typeof hydrator.addAdvancedSwitch>[0][] = [];
	source.map.forEachAdvancedSwitch((record) => switches.push(record));
	for (const [x, y, encoded] of reverseInsertion ? cells.reverse() : cells) {
		hydrator.addEncodedCell(x, y, encoded);
	}
	for (const record of reverseInsertion ? switches.reverse() : switches) {
		hydrator.addAdvancedSwitch(record);
	}
	return {
		map: hydrator.finish(source.map.getRevision(), source.map.getAdvancedSwitchIdCursor()),
		portEquipment: copyPortEquipmentState(source.portEquipment),
		organizations: copyStaticFabOrganizationState(source.organizations),
		patchSequence: source.patchSequence,
	};
}

function reopenedThreeBankFabFixture(): FixtureState {
	const source = threeBankFabFixture();
	const hydrator = TileMap.createHydrator();
	source.map.forEachRail((x, y, _rail, encoded) => hydrator.addEncodedCell(x, y, encoded));
	source.map.forEachAdvancedSwitch((record) => hydrator.addAdvancedSwitch(record));
	return {
		map: hydrator.finish(source.map.getRevision(), source.map.getAdvancedSwitchIdCursor()),
		portEquipment: copyPortEquipmentState(source.portEquipment),
		organizations: copyStaticFabOrganizationState(source.organizations),
		patchSequence: source.patchSequence,
	};
}

function threeBankFabFixture(): FixtureState {
	const placed = placeProductionBays([
		{ x: 0, y: 0 },
		{ x: 100, y: 0 },
		{ x: 200, y: 0 },
		{ x: 300, y: 0 },
		{ x: 0, y: 120 },
		{ x: 100, y: 120 },
	]);
	const bays = placed.organizations.records.filter((record) => record.kind === "BAY");
	let fixture = placed;
	for (let index = 0; index < 3; index += 1) {
		const connection = firstValidConnector(
			fixture,
			bays[index * 2]?.id ?? -1,
			bays[index * 2 + 1]?.id ?? -1,
		);
		if (!connection.prospectiveState) throw new Error(connection.plan.reason);
		fixture = {
			...connection.prospectiveState,
			patchSequence: fixture.patchSequence + 1,
		};
	}
	let roles = deriveStaticFabOrganizationSemanticRoles(fixture.organizations);
	let banks = fixture.organizations.records.filter((record) => roles.get(record.id) === "BAY_BANK");
	for (const [sourceIndex, targetIndex] of [
		[0, 1],
		[0, 1],
		[1, 2],
	] as const) {
		const connection = firstValidConnector(
			fixture,
			banks[sourceIndex]?.id ?? -1,
			banks[targetIndex]?.id ?? -1,
		);
		if (!connection.prospectiveState) throw new Error(connection.plan.reason);
		fixture = {
			...connection.prospectiveState,
			patchSequence: fixture.patchSequence + 1,
		};
		roles = deriveStaticFabOrganizationSemanticRoles(fixture.organizations);
		banks = fixture.organizations.records.filter((record) => roles.get(record.id) === "BAY_BANK");
	}
	return fixture;
}

function connectedFabFixture(): FixtureState {
	const twoBankFab = hierarchyOnlyConnectedFabFixture();
	const roles = deriveStaticFabOrganizationSemanticRoles(twoBankFab.organizations);
	const banks = twoBankFab.organizations.records.filter(
		(record) => roles.get(record.id) === "BAY_BANK",
	);
	const loop = firstValidConnector(twoBankFab, banks[0]?.id ?? -1, banks[1]?.id ?? -1);
	if (!loop.prospectiveState) throw new Error(loop.plan.reason);
	return {
		...loop.prospectiveState,
		patchSequence: twoBankFab.patchSequence + 1,
	};
}

function hierarchyOnlyConnectedFabFixture(): FixtureState {
	const detached = detachedBanksFixture();
	const roles = deriveStaticFabOrganizationSemanticRoles(detached.organizations);
	const banks = detached.organizations.records.filter(
		(record) => roles.get(record.id) === "BAY_BANK",
	);
	const connection = firstValidConnector(detached, banks[0]?.id ?? -1, banks[1]?.id ?? -1);
	if (!connection.prospectiveState) throw new Error(connection.plan.reason);
	return {
		...connection.prospectiveState,
		patchSequence: detached.patchSequence + 1,
	};
}

function detachedBanksFixture(): FixtureState {
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
		...left.prospectiveState,
		patchSequence: placed.patchSequence + 1,
	};
	const right = firstValidConnector(afterLeft, bays[2]?.id ?? -1, bays[3]?.id ?? -1);
	if (!right.prospectiveState) throw new Error(right.plan.reason);
	return {
		...right.prospectiveState,
		patchSequence: afterLeft.patchSequence + 1,
	};
}

function placeProductionBays(anchors: readonly Readonly<{ x: number; y: number }>[]): FixtureState {
	const artifact = certifyProductionBayModuleCatalogRequest(
		defaultProductionBayModuleCatalogRequest("single-production-bay"),
	);
	let fixture: FixtureState = {
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
	const discover =
		purpose === "FAB_LOOP"
			? discoverStaticFabOuterCirculationGateways
			: discoverStaticFabAssemblyGateways;
	const failureReasons = new Set<string>();
	for (const source of discover(fixture.map, fixture.organizations, sourceOrganizationId)) {
		for (const target of discover(fixture.map, fixture.organizations, targetOrganizationId)) {
			for (const side of [null, "left", "right"] as const) {
				const result = planStaticFabAssemblyConnectorWithProspectiveState(
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
				if (result.plan.valid) return result;
				failureReasons.add(result.plan.reason);
			}
		}
	}
	throw new Error(
		failureReasons.size > 0
			? [...failureReasons].join(" | ")
			: "No valid Assembly Connector route was found.",
	);
}

function replaceOrganization(
	state: StaticFabOrganizationState,
	replacement: StaticFabOrganizationRecord,
): StaticFabOrganizationState {
	return copyStaticFabOrganizationState({
		nextOrganizationId: state.nextOrganizationId,
		records: state.records.map((record) =>
			record.id === replacement.id ? copyStaticFabOrganizationRecord(replacement) : record,
		),
	});
}

function attachEquipmentGroup(
	state: StaticFabOrganizationState,
	organizationId: number,
	equipmentGroupId: number,
): StaticFabOrganizationState {
	const record = state.records.find((candidate) => candidate.id === organizationId);
	if (!record) throw new Error(`Expected organization ${organizationId}.`);
	return replaceOrganization(state, {
		...record,
		membership: {
			...record.membership,
			equipmentGroupIds: Object.freeze([...record.membership.equipmentGroupIds, equipmentGroupId]),
		},
	});
}

function regularCardinalRouteForMembership(
	map: TileMap,
	edges: StaticFabOrganizationMembership["railEdges"],
): CardinalPortRoute {
	const edgeKeys = new Set(edges.map(staticFabOrganizationEdgeKey));
	const cells = new Map<string, Readonly<{ x: number; y: number }>>();
	for (const edge of edges) {
		cells.set(`${edge.from.x}:${edge.from.y}`, edge.from);
		cells.set(`${edge.to.x}:${edge.to.y}`, edge.to);
	}
	for (const cell of [...cells.values()].sort(
		(left, right) => left.x - right.x || left.y - right.y,
	)) {
		const rail = map.getRail(cell.x, cell.y);
		if (bitCount(rail.incoming) !== 1 || bitCount(rail.outgoing) !== 1) continue;
		const from = ALL_DIRECTIONS.find((direction) => (rail.incoming & direction) !== 0);
		const to = ALL_DIRECTIONS.find((direction) => (rail.outgoing & direction) !== 0);
		if (from === undefined || to === undefined || from === to) continue;
		const source = moveCell(cell, from);
		const target = moveCell(cell, to);
		if (
			!edgeKeys.has(staticFabOrganizationEdgeKey({ from: source, to: cell })) ||
			!edgeKeys.has(staticFabOrganizationEdgeKey({ from: cell, to: target }))
		) {
			continue;
		}
		return Object.freeze({
			kind: "CARDINAL_CELL",
			x: cell.x,
			z: cell.y,
			from: from as Direction,
			to: to as Direction,
		});
	}
	throw new Error("Expected a complete regular cardinal route in organization membership.");
}

function twoOhbPortEquipment(
	firstRoute: CardinalPortRoute,
	secondRoute: CardinalPortRoute,
): PortEquipmentState {
	const port = (id: number, route: CardinalPortRoute): PortRecord =>
		Object.freeze({
			id,
			equipmentGroupId: id,
			route,
			stationMillimeters: 500,
			side: "CENTER",
			lateralOffsetMillimeters: 0,
			direction: "WITH_TRAVEL",
			portType: "OHB",
			barcode: `OHB-${id}`,
		});
	return Object.freeze({
		nextPortId: 3,
		nextEquipmentGroupId: 3,
		ports: Object.freeze([port(1, firstRoute), port(2, secondRoute)]),
		equipmentGroups: Object.freeze([
			Object.freeze({ id: 1, kind: "OHB", template: "SINGLE", portIds: Object.freeze([1]) }),
			Object.freeze({ id: 2, kind: "OHB", template: "SINGLE", portIds: Object.freeze([2]) }),
		]),
	});
}

function bitCount(value: number): number {
	let remaining = value;
	let count = 0;
	while (remaining !== 0) {
		remaining &= remaining - 1;
		count++;
	}
	return count;
}

function firstWholeModuleMembership(
	fixture: FixtureState,
	record: StaticFabOrganizationRecord,
): StaticFabOrganizationMembership {
	const edge = record.membership.railEdges[0];
	if (!edge) throw new Error("Expected the selected Bank to own Rail.");
	const edgeKey = staticFabOrganizationEdgeKey(edge);
	const module = buildRailModuleOwnershipIndex(fixture.map).modules.find((candidate) =>
		candidate.eraseEdges.some(
			(candidateEdge) => staticFabOrganizationEdgeKey(candidateEdge) === edgeKey,
		),
	);
	if (!module) throw new Error("Expected a selected Bank whole module.");
	return Object.freeze({
		railEdges: Object.freeze([...module.eraseEdges].sort(compareDirectedRailEdges)),
		advancedSwitchIds: Object.freeze(
			module.advancedSwitchId === null ? [] : [module.advancedSwitchId],
		),
		equipmentGroupIds: Object.freeze([]),
	});
}

function mergeMembership(
	left: StaticFabOrganizationMembership,
	right: StaticFabOrganizationMembership,
): StaticFabOrganizationMembership {
	const railEdges = new Map<string, (typeof left.railEdges)[number]>();
	for (const edge of [...left.railEdges, ...right.railEdges]) {
		railEdges.set(`${edge.from.x}:${edge.from.y}>${edge.to.x}:${edge.to.y}`, edge);
	}
	return Object.freeze({
		railEdges: Object.freeze([...railEdges.values()].sort(compareDirectedRailEdges)),
		advancedSwitchIds: Object.freeze(
			[...new Set([...left.advancedSwitchIds, ...right.advancedSwitchIds])].sort((a, b) => a - b),
		),
		equipmentGroupIds: Object.freeze(
			[...new Set([...left.equipmentGroupIds, ...right.equipmentGroupIds])].sort((a, b) => a - b),
		),
	});
}
