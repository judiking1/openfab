import { describe, expect, it } from "vitest";
import { planRailConstruction } from "../core/paint";
import { RailDocument } from "../core/RailDocument";
import { buildRailModuleOwnershipIndex } from "../core/RailModuleOwnership";
import {
	deriveStaticFabOrganizationSemanticRoles,
	staticFabOrganizationParentIds,
} from "../core/StaticFabOrganization";
import {
	createOpenFabFabAssemblyPlan,
	type OpenFabFabAssemblyPlan,
} from "./OpenFabFabAssemblyPlan";
import {
	compileOpenFabFabOrganizations,
	deriveOpenFabFabOrganizationManifest,
	openFabFabOrganizationCertificationFingerprint,
	openFabFabOrganizationEdgeClaimFingerprint,
	validateOpenFabFabCanonicalHierarchy,
} from "./OpenFabFabOrganizationCompiler";
import { defaultOpenFabFabProfile, OPENFAB_FAB_PROFILE_V1_POLICIES } from "./OpenFabFabProfile";
import {
	type CompiledStaticFabOrganizationSeeds,
	type StaticFabOrganizationDirectedEdgeClaim,
	staticFabOrganizationSeedCompilationFingerprint,
} from "./StaticFabOrganizationSeedCompiler";

describe("OpenFabFabOrganizationCompiler", () => {
	it("derives the exact default Fab hierarchy without serializing its Layout Block", () => {
		const plan = createOpenFabFabAssemblyPlan(defaultOpenFabFabProfile());
		const manifest = deriveOpenFabFabOrganizationManifest(plan);

		expect(manifest.counts).toEqual({
			fabs: 1,
			banks: 2,
			bays: 24,
			processLoops: 36,
			organizationRecords: 63,
		});
		expect(manifest.entries[0]).toMatchObject({
			key: "fab-1",
			role: "FAB",
			kind: "AREA",
			parentKey: null,
		});
		expect(manifest.entries).not.toContainEqual(expect.objectContaining({ key: "layout-block-1" }));
		const firstBank = manifest.entries.find((entry) => entry.key === "bank-1");
		const firstBay = manifest.entries.find((entry) => entry.key === "bank-1-bay-1");
		const firstLoop = manifest.entries.find((entry) => entry.key === "bank-1-bay-1-process-loop-1");
		expect(firstBank).toMatchObject({ role: "BAY_BANK", parentKey: "fab-1" });
		expect(firstBay).toMatchObject({ role: "BAY", parentKey: "bank-1" });
		expect(firstLoop).toMatchObject({
			role: "PROCESS_LOOP",
			parentKey: "bank-1-bay-1",
		});
		expect(new Set(manifest.entries.map((entry) => entry.key)).size).toBe(manifest.entries.length);
		expect(manifest.fingerprint).toMatch(/^openfab-fab-organization-manifest:v1:/);
	});

	it("keeps one Fab root across generator-only Blocks and certifies the largest key set", () => {
		const multiBlock = deriveOpenFabFabOrganizationManifest(
			createOpenFabFabAssemblyPlan({
				...defaultOpenFabFabProfile(),
				layoutBlockCount: 3,
			}),
		);
		expect(multiBlock.counts.fabs).toBe(1);
		expect(multiBlock.counts.banks).toBe(6);
		expect(multiBlock.entries.filter((entry) => entry.parentKey === "fab-1")).toHaveLength(6);
		expect(multiBlock.entries.some((entry) => entry.key.startsWith("layout-block-"))).toBe(false);

		const maximum = deriveOpenFabFabOrganizationManifest(
			createOpenFabFabAssemblyPlan({
				kind: "openfab-fab-profile",
				version: 1,
				layoutBlockCount: 3,
				bankRepetitionAxis: "EAST_WEST",
				banksPerLayoutBlock: 3,
				processLoopsPerBank: 24,
				bayPackingPolicy: "SINGLE",
				processLoopLongAxisMeters: 56,
				processLoopCenterPitchMeters: 16,
				...OPENFAB_FAB_PROFILE_V1_POLICIES,
			}),
		);
		expect(maximum.counts).toMatchObject({
			fabs: 1,
			banks: 9,
			bays: 216,
			processLoops: 216,
			organizationRecords: 442,
		});
		expect(new Set(maximum.entries.map((entry) => entry.key)).size).toBe(442);
	});

	it("compiles mutation-derived claims into one exact canonical organization certificate", () => {
		const fixture = organizationFixture();
		const forward = compileOpenFabFabOrganizations(
			fixture.document.map,
			fixture.plan,
			fixture.claims,
		);
		const reversed = compileOpenFabFabOrganizations(
			fixture.document.map,
			fixture.plan,
			[...fixture.claims].reverse(),
		);

		expect(forward.valid, forward.valid ? undefined : forward.reason).toBe(true);
		expect(reversed.valid, reversed.valid ? undefined : reversed.reason).toBe(true);
		if (!forward.valid || !reversed.valid) return;
		expect(forward.compilation.organizationKeys).toHaveLength(
			forward.manifest.counts.organizationRecords,
		);
		expect(
			[
				...deriveStaticFabOrganizationSemanticRoles(forward.compilation.organizations).values(),
			].filter((role) => role === "FAB"),
		).toHaveLength(1);
		expect(
			forward.compilation.organizations.records.reduce(
				(total, record) => total + record.membership.railEdges.length,
				0,
			),
		).toBe(forward.compilation.edgeCount);
		expect(
			forward.compilation.organizations.records.every(
				(record) => staticFabOrganizationParentIds(record).length <= 1,
			),
		).toBe(true);
		expect(validateCanonicalFixture(fixture, forward.compilation)).toBeNull();
		expect(openFabFabOrganizationCertificationFingerprint(forward)).toBe(forward.fingerprint);
		expect(forward.edgeClaimFingerprint).toBe(reversed.edgeClaimFingerprint);
		expect(forward.fingerprint).toBe(reversed.fingerprint);
		expect(forward.authoredChecksum).toBe(reversed.authoredChecksum);
	});

	it("rejects a multi-parent Bay even though the reusable organization model accepts DAGs", () => {
		const fixture = certifiedFixture();
		const bayIndex = fixture.certificate.compilation.organizationKeys.findIndex((key) =>
			/^bank-1-bay-1$/.test(key),
		);
		const bay = fixture.certificate.compilation.organizations.records[bayIndex];
		const fab = fixture.certificate.compilation.organizations.records.find(
			(record) => staticFabOrganizationParentIds(record).length === 0,
		);
		if (!bay || !fab) throw new Error("Expected canonical Fab and Bay records.");
		const organizations = Object.freeze({
			...fixture.certificate.compilation.organizations,
			records: Object.freeze(
				fixture.certificate.compilation.organizations.records.map((record) =>
					record.id === bay.id
						? Object.freeze({
								...record,
								parentOrganizationIds: Object.freeze(
									[...staticFabOrganizationParentIds(record), fab.id].sort((a, b) => a - b),
								),
							})
						: record,
				),
			),
		});
		const forged = refingerprintCompilation(fixture.certificate.compilation, { organizations });

		expect(validateCanonicalFixture(fixture, forged)).toMatchObject({
			code: "PARENT_MISMATCH",
			organizationKey: "bank-1-bay-1",
		});
	});

	it("rejects Layout Block records and stale generic compilation fingerprints", () => {
		const fixture = certifiedFixture();
		const bankIndex = fixture.certificate.compilation.organizationKeys.indexOf("bank-1");
		const organizationKeys = [...fixture.certificate.compilation.organizationKeys];
		organizationKeys[bankIndex] = fixture.plan.layoutBlocks[0]?.key ?? "layout-block-1";
		const layoutBlock = refingerprintCompilation(fixture.certificate.compilation, {
			organizationKeys: Object.freeze(organizationKeys),
		});
		expect(validateCanonicalFixture(fixture, layoutBlock)).toMatchObject({
			code: "LAYOUT_BLOCK_ORGANIZATION",
		});

		const stale = Object.freeze({
			...fixture.certificate.compilation,
			fingerprint: "openfab-static-organization:v1:00000000:00000000",
		});
		expect(validateCanonicalFixture(fixture, stale)).toMatchObject({
			code: "FINGERPRINT_MISMATCH",
		});
	});

	it("rejects refingerprinted sibling records outside canonical topological/key order", () => {
		const fixture = certifiedFixture();
		const leftIndex = fixture.certificate.compilation.organizationKeys.indexOf("bank-1-bay-1");
		const rightIndex = fixture.certificate.compilation.organizationKeys.indexOf("bank-1-bay-2");
		const left = fixture.certificate.compilation.organizations.records[leftIndex];
		const right = fixture.certificate.compilation.organizations.records[rightIndex];
		if (leftIndex < 0 || rightIndex < 0 || !left || !right) {
			throw new Error("Expected sibling Bay records.");
		}
		const organizationKeys = [...fixture.certificate.compilation.organizationKeys];
		[organizationKeys[leftIndex], organizationKeys[rightIndex]] = [
			organizationKeys[rightIndex] as string,
			organizationKeys[leftIndex] as string,
		];
		const records = [...fixture.certificate.compilation.organizations.records];
		records[leftIndex] = Object.freeze({ ...right, id: leftIndex + 1 });
		records[rightIndex] = Object.freeze({ ...left, id: rightIndex + 1 });
		const forged = refingerprintCompilation(fixture.certificate.compilation, {
			organizationKeys: Object.freeze(organizationKeys),
			organizations: Object.freeze({
				...fixture.certificate.compilation.organizations,
				records: Object.freeze(records),
			}),
		});

		expect(validateCanonicalFixture(fixture, forged)).toMatchObject({
			code: "ORGANIZATION_KEY_MISMATCH",
		});
	});

	it("rejects organization metadata that diverges from the canonical manifest", () => {
		const fixture = certifiedFixture();
		const root = fixture.certificate.compilation.organizations.records[0];
		if (!root) throw new Error("Expected the canonical Fab root.");
		const organizations = Object.freeze({
			...fixture.certificate.compilation.organizations,
			records: Object.freeze([
				Object.freeze({ ...root, name: "FORGED FAB NAME" }),
				...fixture.certificate.compilation.organizations.records.slice(1),
			]),
		});
		const forged = refingerprintCompilation(fixture.certificate.compilation, { organizations });

		expect(validateCanonicalFixture(fixture, forged)).toMatchObject({
			code: "METADATA_MISMATCH",
			organizationKey: "fab-1",
		});
	});

	it("rejects refingerprinted organization state with noncanonical membership ordering", () => {
		const fixture = certifiedFixture();
		const recordIndex = fixture.certificate.compilation.organizations.records.findIndex(
			(record) => record.membership.railEdges.length >= 2,
		);
		const record = fixture.certificate.compilation.organizations.records[recordIndex];
		if (!record) throw new Error("Expected a record with at least two rail edges.");
		const [first, second, ...rest] = record.membership.railEdges;
		if (!first || !second) throw new Error("Expected two rail edges.");
		const organizations = Object.freeze({
			...fixture.certificate.compilation.organizations,
			records: Object.freeze(
				fixture.certificate.compilation.organizations.records.map((entry, index) =>
					index === recordIndex
						? Object.freeze({
								...entry,
								membership: Object.freeze({
									...entry.membership,
									railEdges: Object.freeze([second, first, ...rest]),
								}),
							})
						: entry,
				),
			),
		});
		const forged = refingerprintCompilation(fixture.certificate.compilation, { organizations });

		expect(validateCanonicalFixture(fixture, forged)).toMatchObject({
			code: "STATE_SHAPE_MISMATCH",
		});
	});

	it("rejects a forged generic compilation envelope", () => {
		const fixture = certifiedFixture();
		const forged = Object.freeze({
			...fixture.certificate.compilation,
			version: 999,
		}) as unknown as CompiledStaticFabOrganizationSeeds;

		expect(validateCanonicalFixture(fixture, forged)).toMatchObject({
			code: "FINGERPRINT_MISMATCH",
		});

		const firstAssignment = fixture.certificate.compilation.moduleAssignments[0];
		if (!firstAssignment) throw new Error("Expected a module assignment.");
		const malformedAssignment = Object.freeze({
			...fixture.certificate.compilation,
			moduleAssignments: Object.freeze([
				Object.freeze({ ...firstAssignment, moduleKey: null }),
				...fixture.certificate.compilation.moduleAssignments.slice(1),
			]),
		}) as unknown as CompiledStaticFabOrganizationSeeds;
		expect(() => validateCanonicalFixture(fixture, malformedAssignment)).not.toThrow();
		expect(validateCanonicalFixture(fixture, malformedAssignment)).toMatchObject({
			code: "OWNERSHIP_MISMATCH",
		});
	});

	it("recomputes each complete module's canonical owner from its provenance claims", () => {
		const fixture = certifiedFixture();
		const assignment = fixture.certificate.compilation.moduleAssignments.find(
			(entry) => entry.ownerKey !== "fab-1",
		);
		if (!assignment) throw new Error("Expected a non-root module assignment.");
		const moduleAssignments = Object.freeze(
			fixture.certificate.compilation.moduleAssignments.map((entry) =>
				entry === assignment ? Object.freeze({ ...entry, ownerKey: "fab-1" }) : entry,
			),
		);
		const forged = refingerprintCompilation(fixture.certificate.compilation, {
			moduleAssignments,
		});

		expect(validateCanonicalFixture(fixture, forged)).toMatchObject({
			code: "OWNERSHIP_MISMATCH",
			organizationKey: "fab-1",
		});
	});

	it("binds each persisted membership partition to its exact rail module assignment", () => {
		const fixture = certifiedFixture();
		const fabIndex = fixture.certificate.compilation.organizationKeys.indexOf("fab-1");
		const bankIndex = fixture.certificate.compilation.organizationKeys.indexOf("bank-1");
		const fab = fixture.certificate.compilation.organizations.records[fabIndex];
		const bank = fixture.certificate.compilation.organizations.records[bankIndex];
		if (!fab || !bank) throw new Error("Expected Fab and Bank records.");
		const records = [...fixture.certificate.compilation.organizations.records];
		records[fabIndex] = Object.freeze({ ...fab, membership: bank.membership });
		records[bankIndex] = Object.freeze({ ...bank, membership: fab.membership });
		const forged = refingerprintCompilation(fixture.certificate.compilation, {
			organizations: Object.freeze({
				...fixture.certificate.compilation.organizations,
				records: Object.freeze(records),
			}),
		});

		expect(validateCanonicalFixture(fixture, forged)).toMatchObject({
			code: "OWNERSHIP_MISMATCH",
		});
	});

	it("rejects duplicated or noncanonical complete-module identities", () => {
		const fixture = certifiedFixture();
		const [first, second] = fixture.certificate.compilation.moduleAssignments;
		if (!first || !second) throw new Error("Expected at least two module assignments.");
		const moduleAssignments = Object.freeze([
			first,
			Object.freeze({ ...second, moduleKey: first.moduleKey }),
			...fixture.certificate.compilation.moduleAssignments.slice(2),
		]);
		const forged = refingerprintCompilation(fixture.certificate.compilation, {
			moduleAssignments,
		});

		expect(validateCanonicalFixture(fixture, forged)).toMatchObject({
			code: "OWNERSHIP_MISMATCH",
		});

		const multiOwnerIndex = fixture.certificate.compilation.moduleAssignments.findIndex(
			(entry) => entry.ownerKey === "bank-1",
		);
		const multiOwner = fixture.certificate.compilation.moduleAssignments[multiOwnerIndex];
		if (!multiOwner) throw new Error("Expected a Bank module assignment.");
		const reordered = refingerprintCompilation(fixture.certificate.compilation, {
			moduleAssignments: Object.freeze(
				fixture.certificate.compilation.moduleAssignments.map((entry, index) =>
					index === multiOwnerIndex
						? Object.freeze({
								...entry,
								claimedOwnerKeys: Object.freeze(["bank-1-bay-1", "bank-1"]),
							})
						: entry,
				),
			),
		});
		expect(validateCanonicalFixture(fixture, reordered)).toMatchObject({
			code: "OWNERSHIP_MISMATCH",
		});
	});

	it("rejects forged executable assembly evidence before deriving or compiling organizations", () => {
		const fixture = organizationFixture();
		const block = fixture.plan.layoutBlocks[0];
		const bank = block?.banks[0];
		const firstStep = bank?.parentGateway.buildSteps[0];
		if (!block || !bank || !firstStep) throw new Error("Expected a Bank parent gateway step.");
		const forged = Object.freeze({
			...fixture.plan,
			layoutBlocks: Object.freeze([
				Object.freeze({
					...block,
					banks: Object.freeze([
						Object.freeze({
							...bank,
							parentGateway: Object.freeze({
								...bank.parentGateway,
								buildSteps: Object.freeze([
									Object.freeze({
										...firstStep,
										route: Object.freeze(firstStep.route.slice(0, -1)),
									}),
									...bank.parentGateway.buildSteps.slice(1),
								]),
							}),
						}),
						...block.banks.slice(1),
					]),
				}),
			]),
		}) as unknown as OpenFabFabAssemblyPlan;

		expect(() => deriveOpenFabFabOrganizationManifest(forged)).toThrow(/canonical plan/i);
		expect(
			compileOpenFabFabOrganizations(fixture.document.map, forged, fixture.claims),
		).toMatchObject({
			valid: false,
			error: { code: "ASSEMBLY_CONTRACT_MISMATCH" },
		});
	});

	it("binds every edge owner and forwards exact generic provenance failures", () => {
		const fixture = organizationFixture();
		const first = fixture.claims[0];
		const secondOwner = fixture.manifest.entries[1]?.key;
		if (!first || !secondOwner) throw new Error("Expected claim and owner fixtures.");
		const changed = [{ ...first, ownerKey: secondOwner }, ...fixture.claims.slice(1)];
		expect(openFabFabOrganizationEdgeClaimFingerprint(changed)).not.toBe(
			openFabFabOrganizationEdgeClaimFingerprint(fixture.claims),
		);
		expect(
			compileOpenFabFabOrganizations(fixture.document.map, fixture.plan, fixture.claims.slice(1)),
		).toMatchObject({ valid: false, error: { code: "SEED_COMPILATION_FAILED" } });
		expect(
			compileOpenFabFabOrganizations(fixture.document.map, fixture.plan, [
				...fixture.claims,
				first,
			]),
		).toMatchObject({ valid: false, error: { code: "SEED_COMPILATION_FAILED" } });
	});
});

function organizationFixture(): Readonly<{
	plan: OpenFabFabAssemblyPlan;
	manifest: ReturnType<typeof deriveOpenFabFabOrganizationManifest>;
	document: RailDocument;
	claims: readonly StaticFabOrganizationDirectedEdgeClaim[];
}> {
	const plan = createOpenFabFabAssemblyPlan({
		...defaultOpenFabFabProfile(),
		banksPerLayoutBlock: 1,
		processLoopsPerBank: 12,
		bayPackingPolicy: "SINGLE",
		processLoopLongAxisMeters: 36,
		processLoopCenterPitchMeters: 12,
	});
	const manifest = deriveOpenFabFabOrganizationManifest(plan);
	const document = new RailDocument();
	const edgeCount = manifest.entries.length * 5;
	const construction = planRailConstruction(document.map, { x: 0, y: 0 }, { x: edgeCount, y: 0 });
	if (!construction.valid || !document.commit(construction)) {
		throw new Error("Could not build organization compiler fixture.");
	}
	const modules = buildRailModuleOwnershipIndex(document.map).modules.filter(
		(module) => module.kind === "straight",
	);
	if (modules.length !== manifest.entries.length) {
		throw new Error(
			`Expected ${manifest.entries.length} straight modules, received ${modules.length}.`,
		);
	}
	const claims = Object.freeze(
		modules.flatMap((module, index) =>
			module.eraseEdges.map((edge) =>
				Object.freeze({ edge, ownerKey: manifest.entries[index]?.key as string }),
			),
		),
	);
	return Object.freeze({ plan, manifest, document, claims });
}

function certifiedFixture() {
	const fixture = organizationFixture();
	const certificate = compileOpenFabFabOrganizations(
		fixture.document.map,
		fixture.plan,
		fixture.claims,
	);
	if (!certificate.valid) throw new Error(certificate.reason);
	return Object.freeze({ ...fixture, certificate });
}

function validateCanonicalFixture(
	fixture: ReturnType<typeof organizationFixture>,
	compilation: CompiledStaticFabOrganizationSeeds,
) {
	return validateOpenFabFabCanonicalHierarchy(
		fixture.plan,
		compilation,
		fixture.document.map,
		fixture.claims,
	);
}

function refingerprintCompilation(
	source: CompiledStaticFabOrganizationSeeds,
	override: Partial<CompiledStaticFabOrganizationSeeds>,
): CompiledStaticFabOrganizationSeeds {
	const withoutFingerprint = Object.freeze({ ...source, ...override, fingerprint: "" });
	return Object.freeze({
		...withoutFingerprint,
		fingerprint: staticFabOrganizationSeedCompilationFingerprint(withoutFingerprint),
	});
}
