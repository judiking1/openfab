import { beforeAll, describe, expect, it } from "vitest";
import { emptyPortEquipmentState } from "../core/EquipmentGroup";
import {
	type ProductionBayBuildStepOwner,
	type ProductionBayModulePlan,
	planProductionBayModule,
} from "../core/ProductionBayModulePlanner";
import {
	buildRailModuleOwnershipIndex,
	type DirectedRailEdge,
	type RailModuleOwnership,
} from "../core/RailModuleOwnership";
import { planRailRouteBatch } from "../core/RailTemplateCatalog";
import { DIR_E } from "../core/railShape";
import {
	STATIC_FAB_BAY_FLOW_EDIT_VERSION,
	type StaticFabBayFlowEditIntent,
} from "../core/StaticFabBayFlowEdit";
import { staticFabBayFlowEditIntentFingerprint } from "../core/StaticFabBayFlowEditCertification";
import {
	compareDirectedRailEdges,
	type StaticFabOrganizationMembership,
	type StaticFabOrganizationRecord,
	type StaticFabOrganizationState,
	staticFabOrganizationEdgeKey,
} from "../core/StaticFabOrganization";
import { TileMap } from "../core/TileMap";
import { captureRailMirrorSnapshot } from "./RailMirrorChecksum";
import {
	type PreparedStaticFabBayFlowEdit,
	STATIC_FAB_BAY_FLOW_EDIT_COMPACT_REVIEW_LIMIT,
	STATIC_FAB_BAY_FLOW_EDIT_MAX_RAIL_MUTATIONS,
	STATIC_FAB_BAY_FLOW_EDIT_PROTOCOL_VERSION,
} from "./StaticFabBayFlowEditProtocol";
import {
	staticFabBayFlowEditPlanShapeError,
	staticFabBayFlowEditPreparedShapeError,
} from "./StaticFabBayFlowEditResponseValidator";
import {
	hydrateStaticFabBayFlowEditSession,
	prepareStaticFabBayFlowEditInSession,
	type StaticFabBayFlowEditRuntimeSession,
} from "./StaticFabBayFlowEditRuntime";

interface Fixture {
	readonly full: PreparedStaticFabBayFlowEdit;
	readonly compact: PreparedStaticFabBayFlowEdit;
}

describe("StaticFabBayFlowEditResponseValidator", () => {
	let fixture: Fixture;

	beforeAll(() => {
		fixture = createFixture();
	});

	it("accepts the exact full runtime result and authority-free compact rejection", () => {
		expect(staticFabBayFlowEditPreparedShapeError(structuredClone(fixture.full))).toBeNull();
		expect(staticFabBayFlowEditPreparedShapeError(structuredClone(fixture.compact))).toBeNull();
		expect(
			staticFabBayFlowEditPlanShapeError(structuredClone(fixture.full.plan), "full"),
		).toBeNull();
		expect(
			staticFabBayFlowEditPlanShapeError(structuredClone(fixture.compact.plan), "compact"),
		).toBeNull();
	});

	it("accepts a bounded no-plan rejection and rejects any ticket on invalid payloads", () => {
		const noPlan = structuredClone(fixture.compact) as MutablePreparedEnvelope;
		noPlan.plan = null;
		noPlan.review = null;
		noPlan.sourceEvidence = null;
		noPlan.prospectiveEvidence = null;
		noPlan.failureCode = "snapshot";
		expect(staticFabBayFlowEditPreparedShapeError(noPlan)).toBeNull();

		const armed = structuredClone(noPlan) as MutablePreparedEnvelope;
		armed.ticket = structuredClone(fixture.full.ticket);
		expect(staticFabBayFlowEditPreparedShapeError(armed)).toMatch(/rejected.*ticket/i);
	});

	it("requires exact keys at every response boundary", () => {
		const prepared = fullClone(fixture);
		(prepared as unknown as Record<string, unknown>).unexpected = true;
		expect(staticFabBayFlowEditPreparedShapeError(prepared)).toMatch(/prepared.*fields/i);

		const plan = fullClone(fixture);
		(plan.plan as unknown as Record<string, unknown>).unexpected = true;
		expect(staticFabBayFlowEditPreparedShapeError(plan)).toMatch(/plan fields/i);

		const mutation = fullClone(fixture);
		(mutation.plan.mutations[0] as unknown as Record<string, unknown>).unexpected = true;
		expect(staticFabBayFlowEditPreparedShapeError(mutation)).toMatch(/mutation budgets/i);

		const organization = fullClone(fixture);
		const changed = requiredOrganizationMutation(organization);
		(changed.after as unknown as Record<string, unknown>).unexpected = true;
		expect(staticFabBayFlowEditPreparedShapeError(organization)).toMatch(/organization mutations/i);

		const ticket = fullClone(fixture);
		(ticket.ticket as unknown as Record<string, unknown>).unexpected = true;
		expect(staticFabBayFlowEditPreparedShapeError(ticket)).toMatch(/ticket fields/i);
	});

	it("requires the prepared review to exactly equal plan.review", () => {
		const hostile = fullClone(fixture);
		(hostile as unknown as { review: typeof hostile.review }).review = {
			...hostile.review,
			bayName: "forged review",
		};
		expect(staticFabBayFlowEditPreparedShapeError(hostile)).toMatch(/exactly match/i);
	});

	it("enforces full and compact array budgets before inspecting hostile contents", () => {
		const compactAuthority = compactClone(fixture);
		(compactAuthority.plan.mutations as unknown[]).push(
			structuredClone(requiredFull(fixture).plan.mutations[0]),
		);
		expect(staticFabBayFlowEditPreparedShapeError(compactAuthority)).toMatch(/authored authority/i);

		const compactReview = compactClone(fixture);
		const sampledIds = Array.from(
			{ length: STATIC_FAB_BAY_FLOW_EDIT_COMPACT_REVIEW_LIMIT + 1 },
			(_, index) => index + 1,
		);
		setReviewField(compactReview, "changedOrganizationIds", sampledIds);
		expect(staticFabBayFlowEditPreparedShapeError(compactReview)).toMatch(/arrays.*budget/i);

		const fullBudget = fullClone(fixture);
		const oversized: unknown[] = [];
		oversized.length = STATIC_FAB_BAY_FLOW_EDIT_MAX_RAIL_MUTATIONS + 1;
		(fullBudget.plan as unknown as { mutations: unknown[] }).mutations = oversized;
		expect(staticFabBayFlowEditPreparedShapeError(fullBudget)).toMatch(/mutation budgets/i);
	});

	it.each([
		"switchMutations",
		"portMutations",
		"equipmentGroupMutations",
	] as const)("rejects nonempty %s sidecars", (field) => {
		const hostile = fullClone(fixture);
		(hostile.plan[field] as unknown[]).push({});
		expect(staticFabBayFlowEditPreparedShapeError(hostile)).toMatch(/sidecar/i);
	});

	it("requires canonical unique rail cells and organization IDs", () => {
		const railOrder = fullClone(fixture);
		(railOrder.plan.mutations as unknown[]).reverse();
		expect(staticFabBayFlowEditPreparedShapeError(railOrder)).toMatch(/mutation budgets/i);

		const duplicateOrganization = fullClone(fixture);
		(duplicateOrganization.plan.organizationMutations as unknown[]).push(
			structuredClone(requiredOrganizationMutation(duplicateOrganization)),
		);
		expect(staticFabBayFlowEditPreparedShapeError(duplicateOrganization)).toMatch(/not canonical/i);
	});

	it("allows existing-record rail-membership changes only", () => {
		const deleted = fullClone(fixture);
		requiredOrganizationMutation(deleted).after = null;
		expect(staticFabBayFlowEditPreparedShapeError(deleted)).toMatch(/organization mutations/i);

		const renamed = fullClone(fixture);
		const renamedMutation = requiredOrganizationMutation(renamed);
		if (!renamedMutation.after) throw new Error("Expected retained organization.");
		renamedMutation.after.name = `${renamedMutation.after.name} forged`;
		expect(staticFabBayFlowEditPreparedShapeError(renamed)).toMatch(/metadata/i);

		const reparented = fullClone(fixture);
		const reparentedMutation = requiredOrganizationMutation(reparented);
		if (!reparentedMutation.after) throw new Error("Expected retained organization.");
		reparentedMutation.after.parentOrganizationIds = [999];
		expect(staticFabBayFlowEditPreparedShapeError(reparented)).toMatch(/metadata/i);

		const sidecarMembership = fullClone(fixture);
		const sidecarMutation = requiredOrganizationMutation(sidecarMembership);
		if (!sidecarMutation.after) throw new Error("Expected retained organization.");
		sidecarMutation.after.membership.advancedSwitchIds = [1];
		expect(staticFabBayFlowEditPreparedShapeError(sidecarMembership)).toMatch(
			/switch or equipment membership/i,
		);

		const unchanged = fullClone(fixture);
		const unchangedMutation = requiredOrganizationMutation(unchanged);
		if (!unchangedMutation.before || !unchangedMutation.after) {
			throw new Error("Expected retained organization.");
		}
		unchangedMutation.after.membership.railEdges = structuredClone(
			unchangedMutation.before.membership.railEdges,
		);
		expect(staticFabBayFlowEditPreparedShapeError(unchanged)).toMatch(
			/did not change rail membership/i,
		);
	});

	it("accepts the exact nested rail-reference boundary and rejects aggregate overflow", () => {
		const exact = fullClone(fixture);
		const mutation = requiredOrganizationMutation(exact);
		if (!mutation.before || !mutation.after) throw new Error("Expected retained organization.");
		const beforeEdges = canonicalHorizontalEdges(STATIC_FAB_BAY_FLOW_EDIT_MAX_RAIL_MUTATIONS);
		const afterEdges = [...beforeEdges];
		const lastIndex = afterEdges.length - 1;
		const last = afterEdges[lastIndex];
		if (!last) throw new Error("Expected one boundary edge.");
		afterEdges[lastIndex] = {
			from: { ...last.from },
			to: { x: last.from.x, y: last.from.y + 1 },
		};
		mutation.before.membership.railEdges = beforeEdges;
		mutation.after.membership.railEdges = afterEdges;
		setOrganizationMutations(exact, [mutation]);
		setOrganizationImpactAuthorizations(exact, []);
		setReviewField(exact, "changedOrganizationIds", [mutation.id]);

		const exactError = staticFabBayFlowEditPreparedShapeError(exact);
		expect(exactError).not.toMatch(/organization mutations/i);
		expect(exactError).toMatch(/rail delta.*organization membership/i);

		const aggregateOverflow = fullClone(fixture);
		const aggregateMutation = requiredOrganizationMutation(aggregateOverflow);
		if (!aggregateMutation.before || !aggregateMutation.after) {
			throw new Error("Expected retained organization.");
		}
		aggregateMutation.before.membership.railEdges = beforeEdges;
		aggregateMutation.after.membership.railEdges = afterEdges;
		expect(staticFabBayFlowEditPreparedShapeError(aggregateOverflow)).toMatch(
			/membership references exceed.*aggregate budget/i,
		);
	});

	it("rejects a per-record rail-reference overflow before traversing a sparse array", () => {
		const hostile = fullClone(fixture);
		const mutation = requiredOrganizationMutation(hostile);
		if (!mutation.after) throw new Error("Expected retained organization.");
		const oversized: DirectedRailEdge[] = [];
		oversized.length = STATIC_FAB_BAY_FLOW_EDIT_MAX_RAIL_MUTATIONS + 1;
		mutation.after.membership.railEdges = oversized;
		expect(staticFabBayFlowEditPreparedShapeError(hostile)).toMatch(/organization mutations/i);
	});

	it("binds review counts and changed IDs to exact rail and organization deltas", () => {
		const changedCells = fullClone(fixture);
		setReviewField(changedCells, "changedCellCount", changedCells.plan.review.changedCellCount + 1);
		expect(staticFabBayFlowEditPreparedShapeError(changedCells)).toMatch(/review counts/i);

		const removedEdges = fullClone(fixture);
		setReviewField(
			removedEdges,
			"removedDirectedEdgeCount",
			removedEdges.plan.review.removedDirectedEdgeCount + 1,
		);
		expect(staticFabBayFlowEditPreparedShapeError(removedEdges)).toMatch(/review counts/i);

		const changedIds = fullClone(fixture);
		setReviewField(changedIds, "changedOrganizationIds", [999]);
		expect(staticFabBayFlowEditPreparedShapeError(changedIds)).toMatch(/changed organization IDs/i);
	});

	it("requires exact organization-membership and rail delta equality", () => {
		const hostile = fullClone(fixture);
		const mutation = hostile.plan.organizationMutations.find(
			(candidate) => candidate.before !== null && candidate.after !== null,
		) as MutableOrganizationMutation | undefined;
		if (!mutation?.before || !mutation.after) throw new Error("Expected retained organization.");
		const beforeKeys = new Set(
			mutation.before.membership.railEdges.map(staticFabOrganizationEdgeKey),
		);
		const afterOnly = mutation.after.membership.railEdges.find(
			(edge) => !beforeKeys.has(staticFabOrganizationEdgeKey(edge)),
		);
		if (!afterOnly) throw new Error("Expected one added organization edge.");
		mutation.after.membership.railEdges = mutation.after.membership.railEdges.filter(
			(edge) => staticFabOrganizationEdgeKey(edge) !== staticFabOrganizationEdgeKey(afterOnly),
		);
		expect(staticFabBayFlowEditPreparedShapeError(hostile)).toMatch(
			/exactly match organization membership/i,
		);
	});

	it("requires distinct projection fingerprints and consistent detached gateway evidence", () => {
		const fingerprint = fullClone(fixture);
		setReviewField(
			fingerprint,
			"targetAuthoredProjectionFingerprint",
			fingerprint.plan.review.sourceAuthoredProjectionFingerprint,
		);
		expect(staticFabBayFlowEditPreparedShapeError(fingerprint)).toMatch(/changed-flow evidence/i);

		const bank = fullClone(fixture);
		setReviewField(bank, "bankOrganizationId", 900);
		expect(staticFabBayFlowEditPreparedShapeError(bank)).toMatch(/detached.*Bank/i);

		const missingGateway = fullClone(fixture);
		setReviewField(missingGateway, "incidentConnectorCount", 1);
		setReviewField(missingGateway, "bankOrganizationId", 900);
		expect(staticFabBayFlowEditPreparedShapeError(missingGateway)).toMatch(/attached.*gateway/i);
	});

	it("rejects a reviewed external gateway edge present in the mutation delta", () => {
		const hostile = fullClone(fixture);
		const changedEdge = changedOrganizationEdge(hostile);
		setReviewField(hostile, "incidentConnectorCount", 1);
		setReviewField(hostile, "bankOrganizationId", 900);
		setReviewField(hostile, "connectorBankToBayDirectedEdgeKeys", [changedEdge]);
		setReviewField(hostile, "connectorBayToBankDirectedEdgeKeys", ["400:400>401:400"]);
		expect(staticFabBayFlowEditPreparedShapeError(hostile)).toMatch(/gateway edge/i);
	});

	it("rejects a discontinuous ordered gateway route", () => {
		const hostile = fullClone(fixture);
		setReviewField(hostile, "incidentConnectorCount", 1);
		setReviewField(hostile, "bankOrganizationId", 900);
		setReviewField(hostile, "connectorBankToBayDirectedEdgeKeys", [
			"100:100>101:100",
			"200:200>201:200",
		]);
		setReviewField(hostile, "connectorBayToBankDirectedEdgeKeys", ["400:400>401:400"]);
		expect(staticFabBayFlowEditPreparedShapeError(hostile)).toMatch(/review arrays/i);
	});

	it("requires closed source/prospective evidence and exact full-map count parity", () => {
		const open = fullClone(fixture);
		if (!open.sourceEvidence) throw new Error("Expected source evidence.");
		(open.sourceEvidence as MutableTopologyEvidence).authoredStatus = "open";
		expect(staticFabBayFlowEditPreparedShapeError(open)).toMatch(/source topology.*closed/i);

		const diagnostics = fullClone(fixture);
		if (!diagnostics.prospectiveEvidence) throw new Error("Expected prospective evidence.");
		(diagnostics.prospectiveEvidence as MutableTopologyEvidence).physicalDiagnosticCount = 1;
		expect(staticFabBayFlowEditPreparedShapeError(diagnostics)).toMatch(
			/prospective topology.*closed/i,
		);

		const countDrift = fullClone(fixture);
		if (!countDrift.prospectiveEvidence) throw new Error("Expected prospective evidence.");
		(countDrift.prospectiveEvidence as MutableTopologyEvidence).authoredDirectedEdgeCount += 1;
		expect(staticFabBayFlowEditPreparedShapeError(countDrift)).toMatch(/full-map.*count/i);
	});

	it("requires the exact ticket shape, plan fingerprint, projections, and unchanged cursors", () => {
		const extraField = fullClone(fixture);
		(extraField.ticket as unknown as Record<string, unknown>).unexpected = true;
		expect(staticFabBayFlowEditPreparedShapeError(extraField)).toMatch(/ticket fields/i);

		const planFingerprint = fullClone(fixture);
		if (!planFingerprint.ticket) throw new Error("Expected ticket.");
		(planFingerprint.ticket as MutableTicket).planFingerprint = "00000000:00000000";
		expect(staticFabBayFlowEditPreparedShapeError(planFingerprint)).toMatch(/does not bind/i);

		const projection = fullClone(fixture);
		if (!projection.ticket) throw new Error("Expected ticket.");
		(projection.ticket as MutableTicket).targetAuthoredProjectionFingerprint = "00000000:00000000";
		expect(staticFabBayFlowEditPreparedShapeError(projection)).toMatch(/does not bind/i);

		const cursor = fullClone(fixture);
		if (!cursor.ticket) throw new Error("Expected ticket.");
		(cursor.ticket as MutableTicket).prospectiveNextPortId += 1;
		expect(staticFabBayFlowEditPreparedShapeError(cursor)).toMatch(/unchanged cursors/i);

		const checksum = fullClone(fixture);
		if (!checksum.ticket) throw new Error("Expected ticket.");
		(checksum.ticket as MutableTicket).prospectiveChecksum = checksum.ticket.sourceChecksum;
		expect(staticFabBayFlowEditPreparedShapeError(checksum)).toMatch(/checksums/i);
	});
});

function createFixture(): Fixture {
	const sourcePlan = planProductionBayModule({
		anchor: { x: -17, y: 23 },
		outerLengthMeters: 40,
		outerDepthMeters: 22,
		shellMarginMeters: 3,
		processLoopGapMeters: 4,
		gatewayLengthMeters: 6,
		processLoopCount: 2,
		internalFlowPattern: "alternating",
		pose: { forward: DIR_E, side: "right", flow: "forward" },
	});
	const map = materializePlan(sourcePlan);
	const modulesByOwner = semanticModulesByOwner(map, sourcePlan);
	const bayId = 10;
	const organizations = Object.freeze({
		nextOrganizationId: 13,
		records: Object.freeze([
			organizationRecord(bayId, "BAY", "Fixture Bay", [], modulesByOwner.get("BAY") ?? []),
			organizationRecord(
				11,
				"AISLE",
				"Fixture Process Loop A",
				[bayId],
				modulesByOwner.get("process-loop-a") ?? [],
			),
			organizationRecord(
				12,
				"AISLE",
				"Fixture Process Loop B",
				[bayId],
				modulesByOwner.get("process-loop-b") ?? [],
			),
		]),
	}) satisfies StaticFabOrganizationState;
	const snapshot = captureRailMirrorSnapshot(
		map,
		0,
		emptyPortEquipmentState(),
		organizations,
	).snapshot;
	const session = hydrateStaticFabBayFlowEditSession(snapshot);
	const intent = Object.freeze({
		version: STATIC_FAB_BAY_FLOW_EDIT_VERSION,
		bayOrganizationId: bayId,
		targetInternalFlowPattern: "co-rotating" as const,
	});
	const full = prepare(session, intent, 701);
	if (!full.valid || !full.plan || !full.review || !full.ticket) {
		throw new Error(full.reason);
	}
	const compact = prepare(
		session,
		Object.freeze({ ...intent, targetInternalFlowPattern: "alternating" as const }),
		702,
	);
	if (compact.valid || !compact.plan || !compact.review || compact.ticket) {
		throw new Error("Expected one compact no-op response.");
	}
	return Object.freeze({ full, compact });
}

function prepare(
	session: StaticFabBayFlowEditRuntimeSession,
	intent: StaticFabBayFlowEditIntent,
	ticketId: number,
): PreparedStaticFabBayFlowEdit {
	return prepareStaticFabBayFlowEditInSession(
		{
			type: "PREPARE_STATIC_FAB_BAY_FLOW_EDIT",
			version: STATIC_FAB_BAY_FLOW_EDIT_PROTOCOL_VERSION,
			requestId: ticketId,
			ticketId,
			intent,
			expectedIntentFingerprint: staticFabBayFlowEditIntentFingerprint(intent),
			expectedSource: session.sourceIdentity,
		},
		session,
	);
}

function materializePlan(plan: ProductionBayModulePlan): TileMap {
	const map = new TileMap();
	const construction = planRailRouteBatch(map, plan.buildRoutes, "free-closed-primary");
	if (!construction.valid) throw new Error(construction.reason);
	for (const mutation of construction.mutations) {
		map.setEncoded(mutation.x, mutation.y, mutation.after);
	}
	return map;
}

function semanticModulesByOwner(
	map: TileMap,
	plan: ProductionBayModulePlan,
): ReadonlyMap<ProductionBayBuildStepOwner, readonly RailModuleOwnership[]> {
	const semanticOwnerByEdge = new Map<string, ProductionBayBuildStepOwner>();
	for (const step of plan.buildSteps) {
		for (let index = 0; index < step.route.length - 1; index += 1) {
			const from = step.route[index];
			const to = step.route[index + 1];
			if (!from || !to) throw new Error(`Malformed fixture step ${step.id}.`);
			semanticOwnerByEdge.set(staticFabOrganizationEdgeKey({ from, to }), step.owner);
		}
	}
	const modulesByOwner = new Map<ProductionBayBuildStepOwner, RailModuleOwnership[]>();
	for (const module of buildRailModuleOwnershipIndex(map).modules) {
		const owners = new Set<ProductionBayBuildStepOwner>();
		for (const edge of module.eraseEdges) {
			const owner = semanticOwnerByEdge.get(staticFabOrganizationEdgeKey(edge));
			if (!owner) throw new Error(`Fixture module ${module.key} contains an unowned edge.`);
			owners.add(owner);
		}
		const owner = owners.has("BAY")
			? "BAY"
			: owners.size === 1
				? ([...owners][0] as ProductionBayBuildStepOwner)
				: null;
		if (!owner) throw new Error(`Fixture module ${module.key} crosses Process Loop owners.`);
		const owned = modulesByOwner.get(owner) ?? [];
		owned.push(module);
		modulesByOwner.set(owner, owned);
	}
	return modulesByOwner;
}

function organizationRecord(
	id: number,
	kind: StaticFabOrganizationRecord["kind"],
	name: string,
	parentOrganizationIds: readonly number[],
	modules: readonly RailModuleOwnership[],
): StaticFabOrganizationRecord {
	return Object.freeze({
		id,
		kind,
		name,
		parentOrganizationIds: Object.freeze([...parentOrganizationIds]),
		properties: Object.freeze({ description: "", color: "TEAL" as const }),
		membership: membershipFromModules(modules),
	});
}

function membershipFromModules(
	modules: readonly RailModuleOwnership[],
): StaticFabOrganizationMembership {
	const railEdges = new Map<string, DirectedRailEdge>();
	for (const module of modules) {
		for (const edge of module.eraseEdges) railEdges.set(staticFabOrganizationEdgeKey(edge), edge);
	}
	return Object.freeze({
		railEdges: Object.freeze([...railEdges.values()].sort(compareDirectedRailEdges)),
		advancedSwitchIds: Object.freeze([]),
		equipmentGroupIds: Object.freeze([]),
	});
}

type MutablePrepared = ReturnType<typeof fullClone>;

function fullClone(fixture: Fixture) {
	return structuredClone(requiredFull(fixture));
}

function compactClone(fixture: Fixture) {
	const compact = structuredClone(fixture.compact);
	if (!compact.plan || !compact.review) throw new Error("Expected compact plan and review.");
	return {
		...compact,
		plan: compact.plan,
		review: compact.review,
	};
}

function requiredFull(fixture: Fixture) {
	const full = fixture.full;
	if (
		!full.valid ||
		!full.plan ||
		!full.review ||
		!full.ticket ||
		!full.sourceEvidence ||
		!full.prospectiveEvidence
	) {
		throw new Error("Expected full prepared result.");
	}
	return {
		...full,
		plan: full.plan,
		review: full.review,
		ticket: full.ticket,
		sourceEvidence: full.sourceEvidence,
		prospectiveEvidence: full.prospectiveEvidence,
	};
}

function requiredOrganizationMutation(prepared: MutablePrepared) {
	const mutation = prepared.plan.organizationMutations[0];
	if (!mutation) throw new Error("Expected organization mutation.");
	return mutation as MutableOrganizationMutation;
}

interface MutableOrganizationMutation {
	id: number;
	before: MutableOrganizationRecord | null;
	after: MutableOrganizationRecord | null;
}

interface MutablePreparedEnvelope {
	plan: PreparedStaticFabBayFlowEdit["plan"];
	review: PreparedStaticFabBayFlowEdit["review"];
	ticket: PreparedStaticFabBayFlowEdit["ticket"];
	sourceEvidence: PreparedStaticFabBayFlowEdit["sourceEvidence"];
	prospectiveEvidence: PreparedStaticFabBayFlowEdit["prospectiveEvidence"];
	valid: boolean;
	failureCode: PreparedStaticFabBayFlowEdit["failureCode"];
	reason: string;
	planningMilliseconds: number;
	validationMilliseconds: number;
}

interface MutableTopologyEvidence {
	authoredStatus: "empty" | "open" | "disconnected" | "unsafe" | "closed";
	authoredDirectedEdgeCount: number;
	physicalDiagnosticCount: number;
}

interface MutableTicket {
	planFingerprint: string;
	targetAuthoredProjectionFingerprint: string;
	prospectiveNextPortId: number;
	prospectiveChecksum: string;
}

interface MutableOrganizationRecord {
	id: number;
	kind: StaticFabOrganizationRecord["kind"];
	name: string;
	parentOrganizationIds: number[];
	properties: { description: string; color: string };
	membership: {
		railEdges: DirectedRailEdge[];
		advancedSwitchIds: number[];
		equipmentGroupIds: number[];
	};
}

function setReviewField<Key extends keyof MutablePrepared["plan"]["review"]>(
	prepared: MutablePrepared | ReturnType<typeof compactClone>,
	key: Key,
	value: MutablePrepared["plan"]["review"][Key],
): void {
	(prepared.plan.review as MutablePrepared["plan"]["review"])[key] = value;
	(prepared.review as MutablePrepared["plan"]["review"])[key] = structuredClone(value);
}

function setOrganizationMutations(
	prepared: MutablePrepared,
	mutations: readonly MutableOrganizationMutation[],
): void {
	(
		prepared.plan as unknown as {
			organizationMutations: MutableOrganizationMutation[];
		}
	).organizationMutations = [...mutations];
}

function setOrganizationImpactAuthorizations(
	prepared: MutablePrepared,
	authorizations: readonly number[],
): void {
	(
		prepared.plan as unknown as {
			organizationImpactAuthorizations: number[];
		}
	).organizationImpactAuthorizations = [...authorizations];
}

function canonicalHorizontalEdges(count: number): DirectedRailEdge[] {
	return Array.from({ length: count }, (_, index) => ({
		from: { x: index * 2, y: 0 },
		to: { x: index * 2 + 1, y: 0 },
	}));
}

function changedOrganizationEdge(prepared: MutablePrepared): string {
	for (const mutation of prepared.plan.organizationMutations) {
		if (!mutation.before || !mutation.after) continue;
		const afterKeys = new Set(
			mutation.after.membership.railEdges.map(staticFabOrganizationEdgeKey),
		);
		const removed = mutation.before.membership.railEdges.find(
			(edge) => !afterKeys.has(staticFabOrganizationEdgeKey(edge)),
		);
		if (removed) return staticFabOrganizationEdgeKey(removed);
	}
	throw new Error("Expected one changed organization edge.");
}
