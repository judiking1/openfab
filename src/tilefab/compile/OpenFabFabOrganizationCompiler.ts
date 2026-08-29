import { emptyPortEquipmentState } from "../core/EquipmentGroup";
import { OrderedTypedChecksum } from "../core/OrderedTypedChecksum";
import { buildRailModuleOwnershipIndex } from "../core/RailModuleOwnership";
import {
	compareDirectedRailEdges,
	deriveStaticFabOrganizationSemanticRoles,
	type StaticFabOrganizationColor,
	type StaticFabOrganizationKind,
	type StaticFabOrganizationRecord,
	type StaticFabOrganizationSemanticRole,
	staticFabOrganizationEdgeKey,
	staticFabOrganizationParentIds,
	staticFabOrganizationStateShapeError,
} from "../core/StaticFabOrganization";
import type { TileMap } from "../core/TileMap";
import { checksumRailMap } from "../worker/RailMirrorChecksum";
import {
	type OpenFabFabAssemblyPlan,
	validateOpenFabFabAssemblyPlan,
} from "./OpenFabFabAssemblyPlan";
import {
	type CompiledStaticFabOrganizationSeeds,
	compileStaticFabOrganizationSeeds,
	type StaticFabOrganizationDirectedEdgeClaim,
	type StaticFabOrganizationSeed,
	staticFabOrganizationSeedCompilationFingerprint,
} from "./StaticFabOrganizationSeedCompiler";

export const OPENFAB_FAB_ORGANIZATION_CONTRACT_VERSION = 1 as const;
export const OPENFAB_FAB_ORGANIZATION_ROOT_KEY = "fab-1" as const;

export interface OpenFabFabOrganizationManifestEntry {
	readonly key: string;
	readonly role: StaticFabOrganizationSemanticRole;
	readonly kind: StaticFabOrganizationKind;
	readonly parentKey: string | null;
	readonly name: string;
	readonly color: StaticFabOrganizationColor;
}

export interface OpenFabFabOrganizationManifestCounts {
	readonly fabs: 1;
	readonly banks: number;
	readonly bays: number;
	readonly processLoops: number;
	readonly organizationRecords: number;
}

export interface OpenFabFabOrganizationManifest {
	readonly kind: "openfab-fab-organization-manifest";
	readonly version: typeof OPENFAB_FAB_ORGANIZATION_CONTRACT_VERSION;
	readonly rootKey: typeof OPENFAB_FAB_ORGANIZATION_ROOT_KEY;
	readonly assemblyPlanFingerprint: string;
	readonly profilePlanFingerprint: string;
	readonly entries: readonly OpenFabFabOrganizationManifestEntry[];
	readonly counts: OpenFabFabOrganizationManifestCounts;
	readonly fingerprint: string;
}

export const OPENFAB_FAB_ORGANIZATION_ERROR_CODES = [
	"ASSEMBLY_CONTRACT_MISMATCH",
	"STATE_SHAPE_MISMATCH",
	"SEED_COMPILATION_FAILED",
	"LAYOUT_BLOCK_ORGANIZATION",
	"ROOT_KEY_MISMATCH",
	"ORGANIZATION_KEY_MISMATCH",
	"RECORD_ID_MISMATCH",
	"KIND_MISMATCH",
	"METADATA_MISMATCH",
	"PARENT_MISMATCH",
	"ROLE_MISMATCH",
	"ROLE_COUNT_MISMATCH",
	"OWNERSHIP_MISMATCH",
	"FINGERPRINT_MISMATCH",
] as const;

export type OpenFabFabOrganizationErrorCode = (typeof OPENFAB_FAB_ORGANIZATION_ERROR_CODES)[number];

export interface OpenFabFabOrganizationError {
	readonly code: OpenFabFabOrganizationErrorCode;
	readonly message: string;
	readonly organizationKey: string | null;
}

export interface CertifiedOpenFabFabOrganizations {
	readonly valid: true;
	readonly kind: "certified-openfab-fab-organizations";
	readonly version: typeof OPENFAB_FAB_ORGANIZATION_CONTRACT_VERSION;
	readonly manifest: OpenFabFabOrganizationManifest;
	readonly compilation: CompiledStaticFabOrganizationSeeds;
	readonly edgeClaimFingerprint: string;
	/** Canonical map identity including the exact organization records and memberships. */
	readonly authoredChecksum: string;
	readonly fingerprint: string;
}

export interface InvalidOpenFabFabOrganizationCompilation {
	readonly valid: false;
	readonly kind: "invalid-openfab-fab-organizations";
	readonly version: typeof OPENFAB_FAB_ORGANIZATION_CONTRACT_VERSION;
	readonly reason: string;
	readonly error: OpenFabFabOrganizationError;
}

export type OpenFabFabOrganizationCompilationResult =
	| CertifiedOpenFabFabOrganizations
	| InvalidOpenFabFabOrganizationCompilation;

/**
 * Derive the one canonical serialized organization tree from whole-Fab geometry intent. Layout
 * Blocks remain generator-only placement groups and are never emitted as organizations.
 */
export function deriveOpenFabFabOrganizationManifest(
	plan: OpenFabFabAssemblyPlan,
): OpenFabFabOrganizationManifest {
	const assemblyContractError = validateOpenFabFabAssemblyPlan(plan);
	if (assemblyContractError) {
		throw new Error(assemblyContractError);
	}
	const entries: OpenFabFabOrganizationManifestEntry[] = [
		manifestEntry(OPENFAB_FAB_ORGANIZATION_ROOT_KEY, "FAB", "AREA", null, "OpenFab", "TEAL"),
	];
	for (const block of plan.layoutBlocks) {
		for (const bank of block.banks) {
			entries.push(
				manifestEntry(
					bank.organizationKey,
					"BAY_BANK",
					"AREA",
					OPENFAB_FAB_ORGANIZATION_ROOT_KEY,
					`Bay Bank ${bank.ordinal + 1}`,
					"CYAN",
				),
			);
			for (const bay of bank.bays) {
				if (bay.processLoopOrganizationKeys.length !== bay.plan.processLoops.length) {
					throw new Error(
						`OpenFab Bay '${bay.organizationKey}' organization keys do not match its Process Loop plans.`,
					);
				}
				entries.push(
					manifestEntry(
						bay.organizationKey,
						"BAY",
						"BAY",
						bank.organizationKey,
						`Production Bay ${bank.ordinal + 1}.${bay.ordinalWithinBank + 1}`,
						"BLUE",
					),
				);
				for (
					let loopIndex = 0;
					loopIndex < bay.processLoopOrganizationKeys.length;
					loopIndex += 1
				) {
					entries.push(
						manifestEntry(
							bay.processLoopOrganizationKeys[loopIndex] as string,
							"PROCESS_LOOP",
							"AISLE",
							bay.organizationKey,
							`Process Loop ${bank.ordinal + 1}.${bay.ordinalWithinBank + 1}.${loopIndex + 1}`,
							loopIndex % 2 === 0 ? "AMBER" : "VIOLET",
						),
					);
				}
			}
		}
	}

	const keys = new Set<string>();
	for (const entry of entries) {
		if (keys.has(entry.key)) {
			throw new Error(`OpenFab organization key '${entry.key}' is duplicated.`);
		}
		keys.add(entry.key);
	}
	for (const block of plan.layoutBlocks) {
		if (keys.has(block.key)) {
			throw new Error(`Layout Block '${block.key}' cannot be an OpenFab organization.`);
		}
	}

	const counts = manifestCounts(entries);
	const expected = plan.profileDerived.counts;
	if (
		counts.fabs !== expected.fabs ||
		counts.banks !== expected.banks ||
		counts.bays !== expected.bays ||
		counts.processLoops !== expected.processLoops ||
		counts.organizationRecords !== expected.organizationRecords
	) {
		throw new Error(
			`OpenFab organization manifest counts ${countSummary(counts)} do not match profile counts ${countSummary(expected)}.`,
		);
	}

	const withoutFingerprint = Object.freeze({
		kind: "openfab-fab-organization-manifest" as const,
		version: OPENFAB_FAB_ORGANIZATION_CONTRACT_VERSION,
		rootKey: OPENFAB_FAB_ORGANIZATION_ROOT_KEY,
		assemblyPlanFingerprint: plan.fingerprint,
		profilePlanFingerprint: plan.profileDerived.planFingerprint,
		entries: Object.freeze(entries),
		counts,
	});
	return Object.freeze({
		...withoutFingerprint,
		fingerprint: openFabFabOrganizationManifestFingerprint(withoutFingerprint),
	});
}

export function openFabFabOrganizationManifestFingerprint(
	manifest: Omit<OpenFabFabOrganizationManifest, "fingerprint">,
): string {
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings([
		manifest.kind,
		manifest.rootKey,
		manifest.assemblyPlanFingerprint,
		manifest.profilePlanFingerprint,
	]);
	checksum.addNumbers([
		manifest.version,
		manifest.counts.fabs,
		manifest.counts.banks,
		manifest.counts.bays,
		manifest.counts.processLoops,
		manifest.counts.organizationRecords,
	]);
	const entries = [...manifest.entries].sort(compareManifestEntries);
	for (const entry of entries) {
		checksum.addStrings([
			entry.key,
			entry.role,
			entry.kind,
			entry.parentKey ?? "",
			entry.name,
			entry.color,
		]);
	}
	return `openfab-fab-organization-manifest:v${OPENFAB_FAB_ORGANIZATION_CONTRACT_VERSION}:${checksum.digest()}`;
}

/** Stable, order-independent identity for exact mutation-derived semantic provenance. */
export function openFabFabOrganizationEdgeClaimFingerprint(
	claims: readonly StaticFabOrganizationDirectedEdgeClaim[],
): string {
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings(["openfab-fab-organization-edge-claims"]);
	checksum.addNumbers([OPENFAB_FAB_ORGANIZATION_CONTRACT_VERSION, claims.length]);
	const ordered = [...claims].sort(compareClaims);
	for (const claim of ordered) {
		checksum.addStrings([claim.ownerKey, staticFabOrganizationEdgeKey(claim.edge)]);
		checksum.addNumbers([claim.edge.from.x, claim.edge.from.y, claim.edge.to.x, claim.edge.to.y]);
	}
	return `openfab-fab-organization-edge-claims:v${OPENFAB_FAB_ORGANIZATION_CONTRACT_VERSION}:${checksum.digest()}`;
}

/**
 * Validate that a generic seed compilation is exactly the OpenFab tree requested by the assembly
 * plan. This intentionally adds no restriction to the reusable generic DAG compiler.
 */
export function validateOpenFabFabCanonicalHierarchy(
	plan: OpenFabFabAssemblyPlan,
	compilation: CompiledStaticFabOrganizationSeeds,
	map: TileMap,
	edgeClaims: readonly StaticFabOrganizationDirectedEdgeClaim[],
): OpenFabFabOrganizationError | null {
	try {
		return validateOpenFabFabCanonicalHierarchyUnchecked(plan, compilation, map, edgeClaims);
	} catch (error) {
		return organizationError(
			"STATE_SHAPE_MISMATCH",
			error instanceof Error
				? `OpenFab organization evidence is malformed: ${error.message}`
				: "OpenFab organization evidence is malformed.",
		);
	}
}

function validateOpenFabFabCanonicalHierarchyUnchecked(
	plan: OpenFabFabAssemblyPlan,
	compilation: CompiledStaticFabOrganizationSeeds,
	map: TileMap,
	edgeClaims: readonly StaticFabOrganizationDirectedEdgeClaim[],
): OpenFabFabOrganizationError | null {
	const envelope = compilation as unknown as Record<string, unknown>;
	if (
		envelope.valid !== true ||
		envelope.kind !== "compiled-static-fab-organization-seeds" ||
		envelope.version !== 1
	) {
		return organizationError(
			"FINGERPRINT_MISMATCH",
			"OpenFab organization seed compilation envelope is invalid.",
		);
	}
	const stateShapeError = staticFabOrganizationStateShapeError(compilation.organizations);
	if (stateShapeError) {
		return organizationError(
			"STATE_SHAPE_MISMATCH",
			`OpenFab organization state is not canonical: ${stateShapeError}`,
		);
	}
	let manifest: OpenFabFabOrganizationManifest;
	try {
		manifest = deriveOpenFabFabOrganizationManifest(plan);
	} catch (error) {
		return organizationError(
			"ASSEMBLY_CONTRACT_MISMATCH",
			error instanceof Error ? error.message : "OpenFab organization manifest is invalid.",
		);
	}
	const records = compilation.organizations.records;
	if (compilation.organizationKeys.length !== records.length) {
		return organizationError(
			"ORGANIZATION_KEY_MISMATCH",
			`OpenFab organization evidence has ${compilation.organizationKeys.length} keys for ${records.length} records.`,
		);
	}
	const layoutBlockKeys = new Set(plan.layoutBlocks.map((block) => block.key));
	const persistedLayoutBlock = compilation.organizationKeys.find((key) => layoutBlockKeys.has(key));
	if (persistedLayoutBlock) {
		return organizationError(
			"LAYOUT_BLOCK_ORGANIZATION",
			`Layout Block '${persistedLayoutBlock}' is generator-only and cannot be persisted as an organization.`,
			persistedLayoutBlock,
		);
	}
	if (compilation.rootKey !== manifest.rootKey) {
		return organizationError(
			"ROOT_KEY_MISMATCH",
			`OpenFab organization root must be '${manifest.rootKey}', received '${compilation.rootKey}'.`,
			compilation.rootKey,
		);
	}
	const canonicalOrganizationKeys = canonicalManifestOrganizationKeys(manifest);
	if (!stringArrayEquals(compilation.organizationKeys, canonicalOrganizationKeys)) {
		return organizationError(
			"ORGANIZATION_KEY_MISMATCH",
			"OpenFab organization keys are not in canonical topological/key order.",
		);
	}

	const expectedByKey = new Map(manifest.entries.map((entry) => [entry.key, entry]));
	const recordByKey = new Map<string, (typeof records)[number]>();
	for (let index = 0; index < compilation.organizationKeys.length; index += 1) {
		const key = compilation.organizationKeys[index] as string;
		const record = records[index];
		if (!record || recordByKey.has(key) || !expectedByKey.has(key)) {
			return organizationError(
				"ORGANIZATION_KEY_MISMATCH",
				`OpenFab organization key '${key}' is duplicated or not present in the assembly manifest.`,
				key,
			);
		}
		if (record.id !== index + 1) {
			return organizationError(
				"RECORD_ID_MISMATCH",
				`OpenFab organization '${key}' must align with canonical record ID ${index + 1}, received ${record.id}.`,
				key,
			);
		}
		recordByKey.set(key, record);
	}
	if (recordByKey.size !== expectedByKey.size) {
		const missing = manifest.entries.find((entry) => !recordByKey.has(entry.key));
		return organizationError(
			"ORGANIZATION_KEY_MISMATCH",
			`OpenFab organization evidence is missing '${missing?.key ?? "an expected key"}'.`,
			missing?.key ?? null,
		);
	}

	const roles = deriveStaticFabOrganizationSemanticRoles(compilation.organizations);
	for (const entry of manifest.entries) {
		const record = recordByKey.get(entry.key);
		if (!record) {
			return organizationError(
				"ORGANIZATION_KEY_MISMATCH",
				`OpenFab organization '${entry.key}' has no compiled record.`,
				entry.key,
			);
		}
		if (record.kind !== entry.kind) {
			return organizationError(
				"KIND_MISMATCH",
				`OpenFab organization '${entry.key}' must have kind ${entry.kind}, received ${record.kind}.`,
				entry.key,
			);
		}
		if (
			record.name !== entry.name ||
			(record.properties?.color ?? "TEAL") !== entry.color ||
			(record.properties?.description ?? "") !== ""
		) {
			return organizationError(
				"METADATA_MISMATCH",
				`OpenFab organization '${entry.key}' metadata does not match its canonical manifest.`,
				entry.key,
			);
		}
		const expectedParentIds =
			entry.parentKey === null ? [] : [recordByKey.get(entry.parentKey)?.id ?? -1];
		const actualParentIds = staticFabOrganizationParentIds(record);
		if (!numberArrayEquals(actualParentIds, expectedParentIds)) {
			return organizationError(
				"PARENT_MISMATCH",
				`OpenFab organization '${entry.key}' must have the single direct parent '${entry.parentKey ?? "none"}'.`,
				entry.key,
			);
		}
		if (roles.get(record.id) !== entry.role) {
			return organizationError(
				"ROLE_MISMATCH",
				`OpenFab organization '${entry.key}' must derive role ${entry.role}, received ${roles.get(record.id) ?? "NONE"}.`,
				entry.key,
			);
		}
	}
	if (roles.size !== records.length) {
		const unrecognized = compilation.organizationKeys.find(
			(_key, index) => !roles.has(records[index]?.id ?? -1),
		);
		return organizationError(
			"ROLE_MISMATCH",
			"Every canonical OpenFab organization must derive one public semantic role.",
			unrecognized ?? null,
		);
	}
	const actualCounts = semanticRoleCounts(roles.values());
	if (
		actualCounts.fabs !== manifest.counts.fabs ||
		actualCounts.banks !== manifest.counts.banks ||
		actualCounts.bays !== manifest.counts.bays ||
		actualCounts.processLoops !== manifest.counts.processLoops ||
		records.length !== manifest.counts.organizationRecords ||
		compilation.organizations.nextOrganizationId !== records.length + 1
	) {
		return organizationError(
			"ROLE_COUNT_MISMATCH",
			`OpenFab compiled role counts ${countSummary(actualCounts)} do not match ${countSummary(manifest.counts)}.`,
		);
	}
	const exactModuleError = validateExactModuleAssignments(
		map,
		edgeClaims,
		compilation,
		manifest,
		recordByKey,
	);
	if (exactModuleError) return exactModuleError;

	const assignedOwnerKeys = new Set<string>();
	const assignedModuleKeys = new Set<string>();
	const parentKeyByKey = new Map(manifest.entries.map((entry) => [entry.key, entry.parentKey]));
	for (
		let assignmentIndex = 0;
		assignmentIndex < compilation.moduleAssignments.length;
		assignmentIndex += 1
	) {
		const assignment = compilation.moduleAssignments[assignmentIndex];
		if (!assignment) continue;
		const previousModuleKey = compilation.moduleAssignments[assignmentIndex - 1]?.moduleKey;
		if (
			assignment.moduleKey.length === 0 ||
			assignment.moduleKey.length > 256 ||
			assignment.moduleKey.trim() !== assignment.moduleKey ||
			hasAsciiControl(assignment.moduleKey) ||
			assignedModuleKeys.has(assignment.moduleKey) ||
			(previousModuleKey !== undefined && compareText(previousModuleKey, assignment.moduleKey) >= 0)
		) {
			return organizationError(
				"OWNERSHIP_MISMATCH",
				`Rail module key '${assignment.moduleKey}' is invalid, duplicated, or not in canonical order.`,
				assignment.ownerKey,
			);
		}
		assignedModuleKeys.add(assignment.moduleKey);
		if (!expectedByKey.has(assignment.ownerKey)) {
			return organizationError(
				"OWNERSHIP_MISMATCH",
				`Rail module '${assignment.moduleKey}' resolves to unknown OpenFab owner '${assignment.ownerKey}'.`,
				assignment.ownerKey,
			);
		}
		if (
			assignment.claimedOwnerKeys.length === 0 ||
			assignment.claimedOwnerKeys.some(
				(key, index) =>
					typeof key !== "string" ||
					(index > 0 && compareText(assignment.claimedOwnerKeys[index - 1] as string, key) >= 0),
			)
		) {
			return organizationError(
				"OWNERSHIP_MISMATCH",
				`Rail module '${assignment.moduleKey}' provenance owners are empty, duplicated, or not in canonical order.`,
				assignment.ownerKey,
			);
		}
		assignedOwnerKeys.add(assignment.ownerKey);
		for (const claimedOwnerKey of assignment.claimedOwnerKeys) {
			if (!expectedByKey.has(claimedOwnerKey)) {
				return organizationError(
					"OWNERSHIP_MISMATCH",
					`Rail module '${assignment.moduleKey}' contains unknown provenance owner '${claimedOwnerKey}'.`,
					claimedOwnerKey,
				);
			}
		}
		const resolvedOwnerKey = resolveCanonicalModuleOwner(
			assignment.claimedOwnerKeys,
			parentKeyByKey,
		);
		if (resolvedOwnerKey !== assignment.ownerKey) {
			return organizationError(
				"OWNERSHIP_MISMATCH",
				`Rail module '${assignment.moduleKey}' resolves to '${resolvedOwnerKey ?? "no unique canonical owner"}', not '${assignment.ownerKey}'.`,
				assignment.ownerKey,
			);
		}
	}
	for (const entry of manifest.entries) {
		if (!assignedOwnerKeys.has(entry.key)) {
			return organizationError(
				"OWNERSHIP_MISMATCH",
				`OpenFab organization '${entry.key}' owns no complete rail module.`,
				entry.key,
			);
		}
	}
	const ownedEdgeKeys = new Set<string>();
	let ownedEdgeCount = 0;
	for (let index = 0; index < records.length; index += 1) {
		const record = records[index];
		if (!record) continue;
		if (
			record.membership.advancedSwitchIds.length !== 0 ||
			record.membership.equipmentGroupIds.length !== 0
		) {
			return organizationError(
				"OWNERSHIP_MISMATCH",
				"OpenFab organization compiler v1 accepts rail-only ownership.",
				compilation.organizationKeys[index] ?? null,
			);
		}
		for (const edge of record.membership.railEdges) {
			const edgeKey = staticFabOrganizationEdgeKey(edge);
			if (ownedEdgeKeys.has(edgeKey)) {
				return organizationError(
					"OWNERSHIP_MISMATCH",
					`Authored edge '${edgeKey}' belongs to more than one canonical OpenFab organization.`,
					compilation.organizationKeys[index] ?? null,
				);
			}
			ownedEdgeKeys.add(edgeKey);
			ownedEdgeCount += 1;
		}
	}
	if (ownedEdgeCount !== compilation.edgeCount || ownedEdgeKeys.size !== compilation.edgeCount) {
		return organizationError(
			"OWNERSHIP_MISMATCH",
			`OpenFab organizations own ${ownedEdgeKeys.size}/${compilation.edgeCount} authored directed edges.`,
		);
	}
	if (
		compilation.moduleCount !== compilation.moduleAssignments.length ||
		staticFabOrganizationSeedCompilationFingerprint(compilation) !== compilation.fingerprint
	) {
		return organizationError(
			"FINGERPRINT_MISMATCH",
			"OpenFab organization seed compilation fingerprint does not match its exact evidence.",
		);
	}
	return null;
}

function resolveCanonicalModuleOwner(
	claimedOwnerKeys: readonly string[],
	parentKeyByKey: ReadonlyMap<string, string | null>,
): string | null {
	if (claimedOwnerKeys.length === 0 || new Set(claimedOwnerKeys).size !== claimedOwnerKeys.length) {
		return null;
	}
	const isAncestorOf = (candidate: string, descendant: string): boolean => {
		let cursor = parentKeyByKey.get(descendant) ?? null;
		while (cursor !== null) {
			if (cursor === candidate) return true;
			cursor = parentKeyByKey.get(cursor) ?? null;
		}
		return false;
	};
	const candidates = claimedOwnerKeys.filter((candidate) =>
		claimedOwnerKeys.every((other) => other === candidate || isAncestorOf(candidate, other)),
	);
	return candidates.length === 1 ? (candidates[0] as string) : null;
}

function canonicalManifestOrganizationKeys(
	manifest: OpenFabFabOrganizationManifest,
): readonly string[] {
	const childrenByParent = new Map<string, OpenFabFabOrganizationManifestEntry[]>();
	const ready = manifest.entries.filter((entry) => entry.parentKey === null);
	for (const entry of manifest.entries) {
		if (entry.parentKey === null) continue;
		const children = childrenByParent.get(entry.parentKey) ?? [];
		children.push(entry);
		childrenByParent.set(entry.parentKey, children);
	}
	const ordered: string[] = [];
	while (ready.length > 0) {
		ready.sort((left, right) => compareText(left.key, right.key));
		const entry = ready.shift();
		if (!entry) break;
		ordered.push(entry.key);
		ready.push(...(childrenByParent.get(entry.key) ?? []));
	}
	return Object.freeze(ordered);
}

function validateExactModuleAssignments(
	map: TileMap,
	edgeClaims: readonly StaticFabOrganizationDirectedEdgeClaim[],
	compilation: CompiledStaticFabOrganizationSeeds,
	manifest: OpenFabFabOrganizationManifest,
	recordByKey: ReadonlyMap<string, StaticFabOrganizationRecord>,
): OpenFabFabOrganizationError | null {
	const claimOwnerByEdgeKey = new Map<string, string>();
	const manifestKeys = new Set(manifest.entries.map((entry) => entry.key));
	for (const claim of edgeClaims) {
		const edgeKey = staticFabOrganizationEdgeKey(claim.edge);
		if (claimOwnerByEdgeKey.has(edgeKey) || !manifestKeys.has(claim.ownerKey)) {
			return organizationError(
				"OWNERSHIP_MISMATCH",
				`OpenFab edge claim '${edgeKey}' is duplicated or has an unknown owner.`,
				claim.ownerKey,
			);
		}
		claimOwnerByEdgeKey.set(edgeKey, claim.ownerKey);
	}
	const parentKeyByKey = new Map(manifest.entries.map((entry) => [entry.key, entry.parentKey]));
	const modules = [...buildRailModuleOwnershipIndex(map).modules].sort((left, right) =>
		compareText(left.key, right.key),
	);
	if (modules.length !== compilation.moduleAssignments.length) {
		return organizationError(
			"OWNERSHIP_MISMATCH",
			`OpenFab module evidence has ${compilation.moduleAssignments.length}/${modules.length} assignments.`,
		);
	}
	const membershipEdgeKeysByOwner = new Map(
		[...recordByKey].map(([key, record]) => [
			key,
			new Set(record.membership.railEdges.map(staticFabOrganizationEdgeKey)),
		]),
	);
	const partitionedEdgeKeys = new Set<string>();
	for (let index = 0; index < modules.length; index += 1) {
		const module = modules[index];
		const actual = compilation.moduleAssignments[index];
		if (!module || !actual) {
			return organizationError("OWNERSHIP_MISMATCH", "OpenFab module evidence is incomplete.");
		}
		const moduleEdgeKeys = module.eraseEdges.map(staticFabOrganizationEdgeKey);
		const claimedOwnerKeys = [
			...new Set(moduleEdgeKeys.map((edgeKey) => claimOwnerByEdgeKey.get(edgeKey))),
		]
			.filter((key): key is string => key !== undefined)
			.sort(compareText);
		if (
			claimedOwnerKeys.length === 0 ||
			moduleEdgeKeys.some((key) => !claimOwnerByEdgeKey.has(key))
		) {
			return organizationError(
				"OWNERSHIP_MISMATCH",
				`Rail module '${module.key}' has incomplete edge provenance.`,
			);
		}
		const ownerKey = resolveCanonicalModuleOwner(claimedOwnerKeys, parentKeyByKey);
		if (
			ownerKey === null ||
			actual.moduleKey !== module.key ||
			actual.ownerKey !== ownerKey ||
			!stringArrayEquals(actual.claimedOwnerKeys, claimedOwnerKeys)
		) {
			return organizationError(
				"OWNERSHIP_MISMATCH",
				`Rail module '${module.key}' assignment does not match its exact map partition and edge claims.`,
				actual.ownerKey,
			);
		}
		const ownerMembership = membershipEdgeKeysByOwner.get(ownerKey);
		if (!ownerMembership || moduleEdgeKeys.some((edgeKey) => !ownerMembership.has(edgeKey))) {
			return organizationError(
				"OWNERSHIP_MISMATCH",
				`Rail module '${module.key}' edges are not persisted under canonical owner '${ownerKey}'.`,
				ownerKey,
			);
		}
		for (const edgeKey of moduleEdgeKeys) {
			if (partitionedEdgeKeys.has(edgeKey)) {
				return organizationError(
					"OWNERSHIP_MISMATCH",
					`Authored edge '${edgeKey}' appears in more than one module.`,
					ownerKey,
				);
			}
			partitionedEdgeKeys.add(edgeKey);
		}
	}
	if (
		partitionedEdgeKeys.size !== compilation.edgeCount ||
		claimOwnerByEdgeKey.size !== compilation.edgeCount
	) {
		return organizationError(
			"OWNERSHIP_MISMATCH",
			"OpenFab module partition, edge claims, and compiled edge count do not match.",
		);
	}
	return null;
}

function hasAsciiControl(value: string): boolean {
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (code <= 0x1f || code === 0x7f) return true;
	}
	return false;
}

/** Compile and bind an exact organization certificate over one already composed final map. */
export function compileOpenFabFabOrganizations(
	map: TileMap,
	plan: OpenFabFabAssemblyPlan,
	edgeClaims: readonly StaticFabOrganizationDirectedEdgeClaim[],
): OpenFabFabOrganizationCompilationResult {
	let manifest: OpenFabFabOrganizationManifest;
	try {
		manifest = deriveOpenFabFabOrganizationManifest(plan);
	} catch (error) {
		return invalidCompilation(
			organizationError(
				"ASSEMBLY_CONTRACT_MISMATCH",
				error instanceof Error ? error.message : "OpenFab organization manifest is invalid.",
			),
		);
	}
	const seedCompilation = compileStaticFabOrganizationSeeds(
		map,
		organizationSeeds(manifest),
		edgeClaims,
	);
	if (!seedCompilation.valid) {
		return invalidCompilation(
			organizationError(
				"SEED_COMPILATION_FAILED",
				`OpenFab organization seed compilation failed: ${seedCompilation.reason}`,
				seedCompilation.error.seedKeys[0] ?? null,
			),
		);
	}
	const canonicalError = validateOpenFabFabCanonicalHierarchy(
		plan,
		seedCompilation,
		map,
		edgeClaims,
	);
	if (canonicalError) return invalidCompilation(canonicalError);
	const edgeClaimFingerprint = openFabFabOrganizationEdgeClaimFingerprint(edgeClaims);
	const authoredChecksum = checksumRailMap(
		map,
		emptyPortEquipmentState(),
		seedCompilation.organizations,
	);
	const withoutFingerprint = Object.freeze({
		valid: true as const,
		kind: "certified-openfab-fab-organizations" as const,
		version: OPENFAB_FAB_ORGANIZATION_CONTRACT_VERSION,
		manifest,
		compilation: seedCompilation,
		edgeClaimFingerprint,
		authoredChecksum,
	});
	return Object.freeze({
		...withoutFingerprint,
		fingerprint: openFabFabOrganizationCertificationFingerprint(withoutFingerprint),
	});
}

export function openFabFabOrganizationCertificationFingerprint(
	certificate: Omit<CertifiedOpenFabFabOrganizations, "fingerprint">,
): string {
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings([
		certificate.kind,
		certificate.manifest.assemblyPlanFingerprint,
		certificate.manifest.profilePlanFingerprint,
		certificate.manifest.fingerprint,
		certificate.compilation.fingerprint,
		certificate.edgeClaimFingerprint,
		certificate.authoredChecksum,
	]);
	checksum.addNumbers([
		certificate.version,
		certificate.compilation.edgeCount,
		certificate.compilation.moduleCount,
		certificate.compilation.organizations.records.length,
	]);
	return `openfab-fab-organizations:v${OPENFAB_FAB_ORGANIZATION_CONTRACT_VERSION}:${checksum.digest()}`;
}

function organizationSeeds(
	manifest: OpenFabFabOrganizationManifest,
): readonly StaticFabOrganizationSeed[] {
	return Object.freeze(
		manifest.entries.map((entry) =>
			Object.freeze({
				key: entry.key,
				kind: entry.kind,
				name: entry.name,
				parentKeys: Object.freeze(entry.parentKey === null ? [] : [entry.parentKey]),
				color: entry.color,
				description: "",
			}),
		),
	);
}

function manifestEntry(
	key: string,
	role: StaticFabOrganizationSemanticRole,
	kind: StaticFabOrganizationKind,
	parentKey: string | null,
	name: string,
	color: StaticFabOrganizationColor,
): OpenFabFabOrganizationManifestEntry {
	return Object.freeze({ key, role, kind, parentKey, name, color });
}

function manifestCounts(
	entries: readonly OpenFabFabOrganizationManifestEntry[],
): OpenFabFabOrganizationManifestCounts {
	const counts = semanticRoleCounts(entries.map((entry) => entry.role));
	if (counts.fabs !== 1) {
		throw new Error(`OpenFab organization manifest must contain one Fab; found ${counts.fabs}.`);
	}
	return Object.freeze({
		...counts,
		fabs: 1 as const,
		organizationRecords: entries.length,
	});
}

function semanticRoleCounts(roles: Iterable<StaticFabOrganizationSemanticRole>): Readonly<{
	fabs: number;
	banks: number;
	bays: number;
	processLoops: number;
}> {
	let fabs = 0;
	let banks = 0;
	let bays = 0;
	let processLoops = 0;
	for (const role of roles) {
		if (role === "FAB") fabs += 1;
		else if (role === "BAY_BANK") banks += 1;
		else if (role === "BAY") bays += 1;
		else processLoops += 1;
	}
	return Object.freeze({ fabs, banks, bays, processLoops });
}

function organizationError(
	code: OpenFabFabOrganizationErrorCode,
	message: string,
	organizationKey: string | null = null,
): OpenFabFabOrganizationError {
	return Object.freeze({ code, message, organizationKey });
}

function invalidCompilation(
	error: OpenFabFabOrganizationError,
): InvalidOpenFabFabOrganizationCompilation {
	return Object.freeze({
		valid: false,
		kind: "invalid-openfab-fab-organizations",
		version: OPENFAB_FAB_ORGANIZATION_CONTRACT_VERSION,
		reason: error.message,
		error,
	});
}

function compareManifestEntries(
	left: OpenFabFabOrganizationManifestEntry,
	right: OpenFabFabOrganizationManifestEntry,
): number {
	return compareText(left.key, right.key);
}

function compareClaims(
	left: StaticFabOrganizationDirectedEdgeClaim,
	right: StaticFabOrganizationDirectedEdgeClaim,
): number {
	return (
		compareDirectedRailEdges(left.edge, right.edge) || compareText(left.ownerKey, right.ownerKey)
	);
}

function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function numberArrayEquals(left: readonly number[], right: readonly number[]): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}

function stringArrayEquals(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}

function countSummary(counts: {
	readonly fabs: number;
	readonly banks: number;
	readonly bays: number;
	readonly processLoops: number;
	readonly organizationRecords?: number;
}): string {
	return `${counts.fabs} Fab / ${counts.banks} Banks / ${counts.bays} Bays / ${counts.processLoops} Process Loops / ${counts.organizationRecords ?? counts.fabs + counts.banks + counts.bays + counts.processLoops} records`;
}
