import { describe, expect, it } from "vitest";
import { emptyPortEquipmentState } from "../core/EquipmentGroup";
import { planRailConstruction } from "../core/paint";
import { RailDocument } from "../core/RailDocument";
import {
	buildRailModuleOwnershipIndex,
	type RailModuleOwnership,
} from "../core/RailModuleOwnership";
import {
	deriveStaticFabOrganizationSemanticRoles,
	staticFabOrganizationEdgeKey,
	staticFabOrganizationStateError,
} from "../core/StaticFabOrganization";
import {
	compileStaticFabOrganizationSeeds,
	type StaticFabOrganizationDirectedEdgeClaim,
	type StaticFabOrganizationSeed,
	staticFabOrganizationSeedCompilationFingerprint,
} from "./StaticFabOrganizationSeedCompiler";

describe("StaticFabOrganizationSeedCompiler", () => {
	it("closes a Fab -> Bank -> Bay -> Process Loop junction over whole rail modules", () => {
		const fixture = straightFixture(20);
		const [fabModule, bankModule, bayJunctionModule, loopModule] = fixture.modules;
		if (!fabModule || !bankModule || !bayJunctionModule || !loopModule) {
			throw new Error("Expected four straight modules.");
		}
		const claims = [
			...claimModule(fabModule, "fab"),
			...claimModule(bankModule, "bank"),
			...claimModule(bayJunctionModule, (index) => (index < 2 ? "bay" : "loop")),
			...claimModule(loopModule, "loop"),
		];

		const result = compileStaticFabOrganizationSeeds(
			fixture.document.map,
			hierarchySeeds(),
			claims,
		);

		expect(result.valid, result.valid ? undefined : result.reason).toBe(true);
		if (!result.valid) return;
		expect(result.rootKey).toBe("fab");
		expect(result.organizationKeys).toEqual(["fab", "bank", "bay", "loop"]);
		expect(result.edgeCount).toBe(20);
		expect(result.moduleCount).toBe(4);
		expect(result.organizations.records.map((record) => record.id)).toEqual([1, 2, 3, 4]);
		expect(result.organizations.records.map((record) => record.parentOrganizationIds)).toEqual([
			[],
			[1],
			[2],
			[3],
		]);
		expect([...deriveStaticFabOrganizationSemanticRoles(result.organizations).values()]).toEqual([
			"PROCESS_LOOP",
			"BAY",
			"BAY_BANK",
			"FAB",
		]);
		expect(
			result.organizations.records.map((record) => record.membership.railEdges.length),
		).toEqual([5, 5, 5, 5]);
		expect(
			result.moduleAssignments.find((assignment) => assignment.moduleKey === bayJunctionModule.key),
		).toEqual({
			moduleKey: bayJunctionModule.key,
			ownerKey: "bay",
			claimedOwnerKeys: ["bay", "loop"],
		});
		expect(
			staticFabOrganizationStateError(
				fixture.document.map,
				emptyPortEquipmentState(),
				result.organizations,
			),
		).toBeNull();
		expect(result.fingerprint).toMatch(/^openfab-static-organization:v1:/);
		expect(staticFabOrganizationSeedCompilationFingerprint(result)).toBe(result.fingerprint);
		expect(
			staticFabOrganizationSeedCompilationFingerprint({
				...result,
				organizationKeys: Object.freeze(["other-fab", ...result.organizationKeys.slice(1)]),
			}),
		).not.toBe(result.fingerprint);
	});

	it("rejects a module whose provenance crosses sibling Process Loops", () => {
		const fixture = straightFixture(25);
		const [fabModule, bankModule, bayModule, siblingJunction, tailModule] = fixture.modules;
		if (!fabModule || !bankModule || !bayModule || !siblingJunction || !tailModule) {
			throw new Error("Expected five straight modules.");
		}
		const claims = [
			...claimModule(fabModule, "fab"),
			...claimModule(bankModule, "bank"),
			...claimModule(bayModule, "bay"),
			...claimModule(siblingJunction, (index) => (index < 2 ? "loop-a" : "loop-b")),
			...claimModule(tailModule, "loop-a"),
		];

		const result = compileStaticFabOrganizationSeeds(
			fixture.document.map,
			siblingLoopSeeds(),
			claims,
		);

		expect(result).toMatchObject({
			valid: false,
			error: {
				code: "SIBLING_MODULE_CONFLICT",
				moduleKey: siblingJunction.key,
				seedKeys: ["loop-a", "loop-b"],
			},
		});
	});

	it("rejects missing, duplicate, and conflicting directed-edge provenance", () => {
		const fixture = straightFixture(20);
		const claims = successfulClaims(fixture.modules);
		const firstClaim = claims[0];
		if (!firstClaim) throw new Error("Expected an edge claim.");

		expect(
			compileStaticFabOrganizationSeeds(fixture.document.map, hierarchySeeds(), claims.slice(1)),
		).toMatchObject({ valid: false, error: { code: "UNCLAIMED_EDGE" } });
		expect(
			compileStaticFabOrganizationSeeds(fixture.document.map, hierarchySeeds(), [
				...claims,
				firstClaim,
			]),
		).toMatchObject({
			valid: false,
			error: {
				code: "DUPLICATE_EDGE_CLAIM",
				edgeKey: staticFabOrganizationEdgeKey(firstClaim.edge),
			},
		});
		expect(
			compileStaticFabOrganizationSeeds(fixture.document.map, hierarchySeeds(), [
				...claims,
				{ edge: firstClaim.edge, ownerKey: "loop" },
			]),
		).toMatchObject({ valid: false, error: { code: "CONFLICTING_EDGE_CLAIM" } });
	});

	it("fails closed for malformed seed and claim array elements", () => {
		const malformedSeed = compileStaticFabOrganizationSeeds(
			new RailDocument().map,
			[null] as unknown as readonly StaticFabOrganizationSeed[],
			[],
		);
		expect(malformedSeed).toMatchObject({
			valid: false,
			error: { code: "INVALID_SEED" },
		});

		const fixture = straightFixture(20);
		const malformedClaim = compileStaticFabOrganizationSeeds(
			fixture.document.map,
			hierarchySeeds(),
			[null] as unknown as readonly StaticFabOrganizationDirectedEdgeClaim[],
		);
		expect(malformedClaim).toMatchObject({
			valid: false,
			error: { code: "INVALID_EDGE_CLAIM" },
		});
	});

	it("rejects a reachable seed that owns no complete module", () => {
		const fixture = straightFixture(20);
		const result = compileStaticFabOrganizationSeeds(
			fixture.document.map,
			[...hierarchySeeds(), seed("unused-loop", "AISLE", "Unused Process Loop", ["bay"], "GRAY")],
			successfulClaims(fixture.modules),
		);

		expect(result).toMatchObject({
			valid: false,
			error: { code: "EMPTY_SEED", seedKeys: ["unused-loop"] },
		});
	});

	it("assigns topological IDs and fingerprints independently of input order", () => {
		const fixture = straightFixture(25);
		const [fabModule, bankModule, bayModule, loopAModule, loopBModule] = fixture.modules;
		if (!fabModule || !bankModule || !bayModule || !loopAModule || !loopBModule) {
			throw new Error("Expected five straight modules.");
		}
		const seeds = siblingLoopSeeds();
		const claims = [
			...claimModule(fabModule, "fab"),
			...claimModule(bankModule, "bank"),
			...claimModule(bayModule, "bay"),
			...claimModule(loopAModule, "loop-a"),
			...claimModule(loopBModule, "loop-b"),
		];

		const forward = compileStaticFabOrganizationSeeds(fixture.document.map, seeds, claims);
		const reversed = compileStaticFabOrganizationSeeds(
			fixture.document.map,
			[...seeds].reverse(),
			[...claims].reverse(),
		);

		expect(forward.valid).toBe(true);
		expect(reversed.valid).toBe(true);
		if (!forward.valid || !reversed.valid) return;
		expect(forward.organizations).toEqual(reversed.organizations);
		expect(forward.organizationKeys).toEqual(reversed.organizationKeys);
		expect(forward.moduleAssignments).toEqual(reversed.moduleAssignments);
		expect(forward.fingerprint).toBe(reversed.fingerprint);
		expect(forward.organizations.records.map((record) => record.name)).toEqual([
			"Fab",
			"Bay Bank",
			"Production Bay",
			"Process Loop A",
			"Process Loop B",
		]);
	});

	it("keeps the reusable seed compiler permissive for a valid multi-parent DAG", () => {
		const fixture = straightFixture(20);
		const seeds = hierarchySeeds().map((candidate) =>
			candidate.key === "bay"
				? Object.freeze({ ...candidate, parentKeys: Object.freeze(["fab", "bank"]) })
				: candidate,
		);

		const result = compileStaticFabOrganizationSeeds(
			fixture.document.map,
			seeds,
			successfulClaims(fixture.modules),
		);

		expect(result.valid, result.valid ? undefined : result.reason).toBe(true);
		if (!result.valid) return;
		expect(result.organizationKeys).toEqual(["fab", "bank", "bay", "loop"]);
		expect(result.organizations.records[2]?.parentOrganizationIds).toEqual([1, 2]);
	});
});

function straightFixture(edgeCount: number): Readonly<{
	document: RailDocument;
	modules: readonly RailModuleOwnership[];
}> {
	const document = new RailDocument();
	const plan = planRailConstruction(document.map, { x: 0, y: 0 }, { x: edgeCount, y: 0 });
	if (!plan.valid || !document.commit(plan))
		throw new Error(`Could not build ${edgeCount} m rail.`);
	const modules = buildRailModuleOwnershipIndex(document.map).modules.filter(
		(module) => module.kind === "straight",
	);
	return Object.freeze({ document, modules });
}

function successfulClaims(
	modules: readonly RailModuleOwnership[],
): readonly StaticFabOrganizationDirectedEdgeClaim[] {
	const [fabModule, bankModule, bayJunctionModule, loopModule] = modules;
	if (!fabModule || !bankModule || !bayJunctionModule || !loopModule) {
		throw new Error("Expected four straight modules.");
	}
	return Object.freeze([
		...claimModule(fabModule, "fab"),
		...claimModule(bankModule, "bank"),
		...claimModule(bayJunctionModule, (index) => (index < 2 ? "bay" : "loop")),
		...claimModule(loopModule, "loop"),
	]);
}

function claimModule(
	module: RailModuleOwnership,
	owner: string | ((edgeIndex: number) => string),
): readonly StaticFabOrganizationDirectedEdgeClaim[] {
	return module.eraseEdges.map((edge, index) =>
		Object.freeze({
			edge,
			ownerKey: typeof owner === "string" ? owner : owner(index),
		}),
	);
}

function hierarchySeeds(): readonly StaticFabOrganizationSeed[] {
	return Object.freeze([
		seed("fab", "AREA", "Fab", [], "TEAL"),
		seed("bank", "AREA", "Bay Bank", ["fab"], "CYAN"),
		seed("bay", "BAY", "Production Bay", ["bank"], "BLUE"),
		seed("loop", "AISLE", "Process Loop", ["bay"], "AMBER"),
	]);
}

function siblingLoopSeeds(): readonly StaticFabOrganizationSeed[] {
	return Object.freeze([
		seed("fab", "AREA", "Fab", [], "TEAL"),
		seed("bank", "AREA", "Bay Bank", ["fab"], "CYAN"),
		seed("bay", "BAY", "Production Bay", ["bank"], "BLUE"),
		seed("loop-b", "AISLE", "Process Loop B", ["bay"], "VIOLET"),
		seed("loop-a", "AISLE", "Process Loop A", ["bay"], "AMBER"),
	]);
}

function seed(
	key: string,
	kind: StaticFabOrganizationSeed["kind"],
	name: string,
	parentKeys: readonly string[],
	color: StaticFabOrganizationSeed["color"],
): StaticFabOrganizationSeed {
	return Object.freeze({
		key,
		kind,
		name,
		parentKeys: Object.freeze([...parentKeys]),
		color,
		description: "",
	});
}
