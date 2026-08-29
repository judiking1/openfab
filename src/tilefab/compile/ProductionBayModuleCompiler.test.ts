import { describe, expect, it } from "vitest";
import type { ProductionBayModuleRequest } from "../core/ProductionBayModulePlanner";
import { DIR_E, DIR_N } from "../core/railShape";
import {
	materializeStaticFabOrganizationBundle,
	prepareStaticFabOrganizationBundle,
	staticFabOrganizationBundleError,
} from "../core/StaticFabOrganizationBundle";
import { certifyProductionBayModule } from "./ProductionBayModuleCompiler";

describe("ProductionBayModuleCompiler", () => {
	it.each([
		1, 2,
	] as const)("certifies a %i-Process-Loop Bay as one portable hierarchy", (processLoopCount) => {
		const artifact = certifyProductionBayModule(request({ processLoopCount }));

		expect(artifact).toMatchObject({
			kind: "certified-production-bay-module",
			version: 2,
			placementReady: true,
			topology: {
				status: "closed",
				components: 1,
				strongComponents: 1,
				openEnds: 0,
				unsafeJunctions: 0,
			},
			physical: {
				valid: true,
				strongComponents: 1,
				openPaths: 0,
				invalidPaths: 0,
				clearanceIssueCount: 0,
			},
		});
		expect(artifact.fingerprint).toMatch(/^[0-9a-f]{8}:[0-9a-f]{8}$/);
		expect(artifact.organizationBundle.rootOrganizationIndices).toEqual([0]);
		expect(artifact.organizationBundle.organizations).toHaveLength(processLoopCount + 1);
		expect(
			artifact.organizationBundle.organizations.map((organization) => organization.kind),
		).toEqual(["BAY", ...Array.from({ length: processLoopCount }, () => "AISLE" as const)]);
		expect(artifact.organizationBundle.organizations[0]?.parentOrganizationIndices).toEqual([]);
		for (const processLoop of artifact.organizationBundle.organizations.slice(1)) {
			expect(processLoop.parentOrganizationIndices).toEqual([0]);
		}
		expect(staticFabOrganizationBundleError(artifact.organizationBundle)).toBeNull();
		expect(prepareStaticFabOrganizationBundle(artifact.organizationBundle).valid).toBe(true);
		expectExactEdgeOwnership(artifact.organizationBundle);
		expect(artifact.readiness).toMatchObject({
			status: "ready",
			ready: true,
			summary: {
				weakComponents: 1,
				strongComponents: 1,
				openTerminals: 0,
				physicalStrongComponents: 1,
				physicalOpenPaths: 0,
				clearanceIssues: 0,
			},
		});
		expectSemanticOwnership(artifact);
	});

	it("is deterministic while preserving pose and variant identity", () => {
		const base = certifyProductionBayModule(request());
		const clone = certifyProductionBayModule(JSON.parse(JSON.stringify(request())));
		const single = certifyProductionBayModule(request({ processLoopCount: 1 }));
		const rotated = certifyProductionBayModule(
			request({ pose: { forward: DIR_N, side: "left", flow: "reverse" } }),
		);

		expect(clone.fingerprint).toBe(base.fingerprint);
		expect(clone.authoredChecksum).toBe(base.authoredChecksum);
		expect(clone.physicalFingerprint).toBe(base.physicalFingerprint);
		expect(new Set([base.fingerprint, single.fingerprint, rotated.fingerprint]).size).toBe(3);
		expect(Object.isFrozen(base)).toBe(true);
		expect(Object.isFrozen(base.organizationBundle)).toBe(true);
	});

	it("materializes the certified hierarchy at all four rotations without changing identity", () => {
		const artifact = certifyProductionBayModule(request());
		for (const quarterTurns of [0, 1, 2, 3] as const) {
			const materialized = materializeStaticFabOrganizationBundle(
				artifact.organizationBundle,
				{ x: 500, y: -200 },
				quarterTurns,
			);
			expect(materialized.railEdges).toHaveLength(artifact.organizationBundle.railEdges.length);
			expect(materialized.organizations).toHaveLength(
				artifact.organizationBundle.organizations.length,
			);
			expect(materialized.rootOrganizationIndices).toEqual([0]);
			expect(materialized.quarterTurns).toBe(quarterTurns);
		}
	});
});

function request(overrides: Partial<ProductionBayModuleRequest> = {}): ProductionBayModuleRequest {
	return {
		anchor: { x: 0, y: 0 },
		outerLengthMeters: 40,
		outerDepthMeters: 22,
		shellMarginMeters: 3,
		processLoopGapMeters: 4,
		gatewayLengthMeters: 6,
		processLoopCount: 2,
		pose: { forward: DIR_E, side: "right", flow: "forward" },
		...overrides,
	};
}

function expectExactEdgeOwnership(
	bundle: ReturnType<typeof certifyProductionBayModule>["organizationBundle"],
): void {
	const claimed = bundle.organizations.flatMap(
		(organization) => organization.membership.railEdgeIndices,
	);
	expect(claimed).toHaveLength(bundle.railEdges.length);
	expect(new Set(claimed).size).toBe(bundle.railEdges.length);
	expect([...claimed].sort((left, right) => left - right)).toEqual(
		Array.from({ length: bundle.railEdges.length }, (_, index) => index),
	);
}

function expectSemanticOwnership(artifact: ReturnType<typeof certifyProductionBayModule>): void {
	const bundle = artifact.organizationBundle;
	const root = bundle.organizations[0];
	if (!root) throw new Error("Missing Production Bay root organization.");
	const rootKeys = new Set(
		root.membership.railEdgeIndices.map((index) => edgeKey(bundle.railEdges[index])),
	);
	for (const step of artifact.plan.buildSteps.filter((candidate) => candidate.owner === "BAY")) {
		for (let index = 0; index < step.route.length - 1; index++) {
			expect(rootKeys.has(edgeKey({ from: step.route[index], to: step.route[index + 1] }))).toBe(
				true,
			);
		}
	}
	for (let loopIndex = 0; loopIndex < artifact.plan.processLoops.length; loopIndex++) {
		const organization = bundle.organizations[loopIndex + 1];
		const loop = artifact.plan.processLoops[loopIndex];
		if (!organization || !loop) throw new Error("Missing Process Loop organization.");
		const loopKeys = new Set(
			loop.cells.slice(0, -1).map((from, index) => edgeKey({ from, to: loop.cells[index + 1] })),
		);
		expect(organization.membership.railEdgeIndices.length).toBeGreaterThan(0);
		for (const edgeIndex of organization.membership.railEdgeIndices) {
			expect(loopKeys.has(edgeKey(bundle.railEdges[edgeIndex]))).toBe(true);
		}
	}
}

function edgeKey(
	edge: Readonly<{
		from: Readonly<{ x: number; y: number }> | undefined;
		to: Readonly<{ x: number; y: number }> | undefined;
	}>,
): string {
	if (!edge.from || !edge.to)
		throw new Error("Missing edge while checking Production Bay ownership.");
	return `${edge.from.x},${edge.from.y}>${edge.to.x},${edge.to.y}`;
}
