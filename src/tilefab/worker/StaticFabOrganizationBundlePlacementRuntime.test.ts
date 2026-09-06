import { describe, expect, it } from "vitest";
import { RailDocument } from "../core/RailDocument";
import {
	buildRailModuleOwnershipIndex,
	type DirectedRailEdge,
	type RailModuleOwnership,
} from "../core/RailModuleOwnership";
import {
	defaultRailTemplateParameters,
	initialRailTemplatePose,
	planRailTemplate,
} from "../core/RailTemplateCatalog";
import {
	compareDirectedRailEdges,
	type StaticFabOrganizationMembership,
	type StaticFabOrganizationState,
	staticFabOrganizationEdgeKey,
} from "../core/StaticFabOrganization";
import {
	captureStaticFabOrganizationBundle,
	type StaticFabOrganizationBundle,
} from "../core/StaticFabOrganizationBundle";
import {
	staticFabOrganizationBundleFingerprint,
	staticFabOrganizationBundlePlacementFingerprint,
} from "../core/StaticFabOrganizationBundlePlacement";
import { captureRailMirrorSnapshot } from "./RailMirrorChecksum";
import type { PrepareStaticFabOrganizationBundlePlacementRequest } from "./StaticFabOrganizationBundlePlacementProtocol";
import { staticFabOrganizationBundlePlacementPreparedShapeError } from "./StaticFabOrganizationBundlePlacementResponseValidator";
import { prepareStaticFabOrganizationBundlePlacement } from "./StaticFabOrganizationBundlePlacementRuntime";

describe("StaticFabOrganizationBundlePlacementRuntime", () => {
	it("plans and validates an exact source-bound plan from immutable bundle intent", () => {
		const destination = new RailDocument();
		const bundle = sourceBundle();
		const request = placementRequest(destination, bundle, { x: 40, y: -20 }, 0, 71);
		let now = 0;
		const result = prepareStaticFabOrganizationBundlePlacement(request, () => ++now);

		expect(staticFabOrganizationBundlePlacementPreparedShapeError(result)).toBeNull();
		expect(result.valid, result.reason).toBe(true);
		expect(result.failureCode).toBeNull();
		expect(result.plan).not.toBeNull();
		expect(result.plan?.organizationBundle.anchor).toEqual({ x: 40, y: -20 });
		expect(result.ticket).toMatchObject({
			ticketId: 71,
			validationLevel: "exact",
			sourceRevision: request.snapshot.revision,
			sourcePatchSequence: request.snapshot.sequence,
			sourceChecksum: request.snapshot.checksum,
			sourceNextOrganizationId: destination.organizations.nextOrganizationId,
			bundleFingerprint: request.expectedBundleFingerprint,
			anchor: { x: 40, y: -20 },
			quarterTurns: 0,
		});
		if (!result.plan || !result.ticket) throw new Error("Expected an exact Worker plan.");
		expect(result.ticket.planFingerprint).toBe(
			staticFabOrganizationBundlePlacementFingerprint(result.plan),
		);
		expect(result.ticket.prospectiveChecksum).not.toBe(request.snapshot.checksum);
		expect(result.planningMilliseconds).toBeGreaterThanOrEqual(0);
		expect(result.validationMilliseconds).toBeGreaterThanOrEqual(0);
		expect(destination.map.size).toBe(0);
		expect(destination.organizations.records).toHaveLength(0);
	});

	it("rejects a bundle changed after the main thread bound its fingerprint", () => {
		const destination = new RailDocument();
		const bundle = structuredClone(sourceBundle()) as MutableBundle;
		const expectedBundleFingerprint = staticFabOrganizationBundleFingerprint(bundle);
		const organization = bundle.organizations[0];
		if (!organization) throw new Error("Expected a portable organization.");
		organization.name = "Changed after permit";
		const request = placementRequest(destination, bundle, { x: 40, y: -20 }, 0, 72);

		const result = prepareStaticFabOrganizationBundlePlacement({
			...request,
			expectedBundleFingerprint,
		});

		expect(result).toMatchObject({
			valid: false,
			failureCode: "fingerprint",
			plan: null,
			ticket: null,
		});
	});

	it("returns a compact non-committable rejection when the exact footprint overlaps", () => {
		const destination = new RailDocument();
		const existing = planRailTemplate(
			destination.map,
			"long-bay",
			{ x: 0, y: 0 },
			initialRailTemplatePose(),
			defaultRailTemplateParameters("long-bay"),
		);
		if (!existing.valid || !destination.commit(existing)) throw new Error(existing.reason);
		const result = prepareStaticFabOrganizationBundlePlacement(
			placementRequest(destination, sourceBundle(), { x: 0, y: 0 }, 0, 73),
		);

		expect(staticFabOrganizationBundlePlacementPreparedShapeError(result)).toBeNull();
		expect(result.valid).toBe(false);
		expect(result.failureCode).toBe("plan");
		expect(result.ticket).toBeNull();
		expect(result.plan?.valid).toBe(false);
		expect(result.plan?.mutations).toHaveLength(0);
		expect(result.conflictCount).toBeGreaterThan(0);
		expect(result.conflictCells.length).toBeLessThanOrEqual(512);
	});

	it("rejects a snapshot whose typed payload checksum is corrupted before planning", () => {
		const destination = new RailDocument();
		const request = placementRequest(destination, sourceBundle(), { x: 40, y: -20 }, 0, 74);

		const result = prepareStaticFabOrganizationBundlePlacement({
			...request,
			snapshot: { ...request.snapshot, checksum: "00000000" },
		});

		expect(result).toMatchObject({
			valid: false,
			failureCode: "snapshot",
			plan: null,
			ticket: null,
		});
		expect(result.reason).toContain("checksum");
	});

	it("rejects invalid portable input without issuing a plan or ticket", () => {
		const destination = new RailDocument();
		const request = placementRequest(destination, sourceBundle(), { x: 40, y: -20 }, 0, 75);

		const result = prepareStaticFabOrganizationBundlePlacement({
			...request,
			bundle: { ...request.bundle, organizations: [] },
		});

		expect(result).toMatchObject({
			valid: false,
			failureCode: "bundle",
			plan: null,
			ticket: null,
		});
	});
});

type MutableBundle = Omit<StaticFabOrganizationBundle, "organizations"> & {
	organizations: Array<
		Omit<StaticFabOrganizationBundle["organizations"][number], "name"> & { name: string }
	>;
};

function placementRequest(
	destination: RailDocument,
	bundle: StaticFabOrganizationBundle,
	anchor: { x: number; y: number },
	quarterTurns: 0 | 1 | 2 | 3,
	ticketId: number,
): PrepareStaticFabOrganizationBundlePlacementRequest {
	return {
		type: "PREPARE_STATIC_FAB_ORGANIZATION_BUNDLE_PLACEMENT",
		requestId: ticketId,
		ticketId,
		snapshot: captureRailMirrorSnapshot(
			destination.map,
			destination.getPatchSequence(),
			destination.portEquipment,
			destination.organizations,
		).snapshot,
		bundle,
		expectedBundleFingerprint: staticFabOrganizationBundleFingerprint(bundle),
		anchor,
		quarterTurns,
	};
}

function sourceBundle(): StaticFabOrganizationBundle {
	const source = new RailDocument();
	const plan = planRailTemplate(
		source.map,
		"long-bay",
		{ x: 0, y: 0 },
		initialRailTemplatePose(),
		defaultRailTemplateParameters("long-bay"),
	);
	if (!plan.valid || !source.commit(plan)) throw new Error(plan.reason);
	const modules = buildRailModuleOwnershipIndex(source.map).modules;
	const organizations: StaticFabOrganizationState = Object.freeze({
		nextOrganizationId: 2,
		records: Object.freeze([
			Object.freeze({
				id: 1,
				kind: "BAY" as const,
				name: "Worker Proof Bay",
				parentOrganizationIds: Object.freeze([]),
				properties: Object.freeze({ description: "", color: "CYAN" as const }),
				membership: membershipFromModules(modules),
			}),
		]),
	});
	const capture = captureStaticFabOrganizationBundle(
		source.map,
		source.portEquipment,
		source.getPatchSequence(),
		organizations,
		source.relationships,
		[1],
		"DIRECT",
	);
	if (!capture.valid) throw new Error(capture.reason);
	return capture.bundle;
}

function membershipFromModules(
	modules: readonly RailModuleOwnership[],
): StaticFabOrganizationMembership {
	const edges = new Map<string, DirectedRailEdge>();
	const switchIds = new Set<number>();
	for (const module of modules) {
		for (const edge of module.eraseEdges) edges.set(staticFabOrganizationEdgeKey(edge), edge);
		if (module.advancedSwitchId !== null) switchIds.add(module.advancedSwitchId);
	}
	return Object.freeze({
		railEdges: Object.freeze([...edges.values()].sort(compareDirectedRailEdges)),
		advancedSwitchIds: Object.freeze([...switchIds].sort((left, right) => left - right)),
		equipmentGroupIds: Object.freeze([]),
	});
}
