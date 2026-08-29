import { emptyPortEquipmentState } from "../core/EquipmentGroup";
import { OrderedTypedChecksum } from "../core/OrderedTypedChecksum";
import {
	buildRailModuleOwnershipIndex,
	type DirectedRailEdge,
	type RailModuleOwnership,
} from "../core/RailModuleOwnership";
import { ALL_DIRECTIONS, directionBetween, moveCell } from "../core/railShape";
import {
	compareDirectedRailEdges,
	copyStaticFabOrganizationState,
	STATIC_FAB_ORGANIZATION_COLORS,
	STATIC_FAB_ORGANIZATION_KINDS,
	type StaticFabOrganizationColor,
	type StaticFabOrganizationKind,
	type StaticFabOrganizationRecord,
	type StaticFabOrganizationState,
	staticFabOrganizationEdgeKey,
	staticFabOrganizationStateError,
} from "../core/StaticFabOrganization";
import type { TileMap } from "../core/TileMap";

export const STATIC_FAB_ORGANIZATION_SEED_COMPILER_VERSION = 1 as const;

export interface StaticFabOrganizationSeed {
	readonly key: string;
	readonly kind: StaticFabOrganizationKind;
	readonly name: string;
	readonly parentKeys: readonly string[];
	readonly color: StaticFabOrganizationColor;
	readonly description: string;
}

export interface StaticFabOrganizationDirectedEdgeClaim {
	readonly edge: DirectedRailEdge;
	readonly ownerKey: string;
}

export interface StaticFabOrganizationModuleAssignment {
	readonly moduleKey: string;
	readonly ownerKey: string;
	readonly claimedOwnerKeys: readonly string[];
}

export const STATIC_FAB_ORGANIZATION_SEED_COMPILE_ERROR_CODES = [
	"NO_SEEDS",
	"EMPTY_MAP",
	"INVALID_SEED",
	"DUPLICATE_SEED_KEY",
	"DUPLICATE_PARENT_KEY",
	"MISSING_PARENT",
	"CYCLIC_HIERARCHY",
	"UNREACHABLE_SEED",
	"UNSUPPORTED_ADVANCED_SWITCH",
	"INVALID_EDGE_CLAIM",
	"UNKNOWN_EDGE_OWNER",
	"DUPLICATE_EDGE_CLAIM",
	"CONFLICTING_EDGE_CLAIM",
	"CLAIMED_EDGE_NOT_IN_MAP",
	"UNCLAIMED_EDGE",
	"MODULE_PARTITION_ERROR",
	"SIBLING_MODULE_CONFLICT",
	"EMPTY_SEED",
	"STATE_INVALID",
] as const;

export type StaticFabOrganizationSeedCompileErrorCode =
	(typeof STATIC_FAB_ORGANIZATION_SEED_COMPILE_ERROR_CODES)[number];

export interface StaticFabOrganizationSeedCompileError {
	readonly code: StaticFabOrganizationSeedCompileErrorCode;
	readonly message: string;
	readonly seedKeys: readonly string[];
	readonly moduleKey: string | null;
	readonly edgeKey: string | null;
}

export interface CompiledStaticFabOrganizationSeeds {
	readonly valid: true;
	readonly kind: "compiled-static-fab-organization-seeds";
	readonly version: typeof STATIC_FAB_ORGANIZATION_SEED_COMPILER_VERSION;
	readonly rootKey: string;
	/** Stable seed identity aligned one-to-one with `organizations.records`. */
	readonly organizationKeys: readonly string[];
	readonly organizations: StaticFabOrganizationState;
	readonly edgeCount: number;
	readonly moduleCount: number;
	readonly moduleAssignments: readonly StaticFabOrganizationModuleAssignment[];
	readonly fingerprint: string;
}

export interface InvalidStaticFabOrganizationSeedCompilation {
	readonly valid: false;
	readonly kind: "invalid-static-fab-organization-seeds";
	readonly version: typeof STATIC_FAB_ORGANIZATION_SEED_COMPILER_VERSION;
	readonly reason: string;
	readonly error: StaticFabOrganizationSeedCompileError;
}

export type StaticFabOrganizationSeedCompileResult =
	| CompiledStaticFabOrganizationSeeds
	| InvalidStaticFabOrganizationSeedCompilation;

interface PreparedSeed extends StaticFabOrganizationSeed {
	readonly parentKeys: readonly string[];
}

export interface StaticFabOrganizationSeedCompilationFingerprintSource {
	readonly rootKey: string;
	readonly organizationKeys: readonly string[];
	readonly organizations: StaticFabOrganizationState;
	readonly edgeCount: number;
	readonly moduleAssignments: readonly StaticFabOrganizationModuleAssignment[];
}

/**
 * Compile semantic edge provenance into one exact, module-closed organization hierarchy.
 *
 * V1 is intentionally rail-only. Layout Block has no persisted kind or role here; callers must keep
 * that generator-only grouping outside these semantic organization seeds.
 */
export function compileStaticFabOrganizationSeeds(
	map: TileMap,
	seedInputs: readonly StaticFabOrganizationSeed[],
	edgeClaimInputs: readonly StaticFabOrganizationDirectedEdgeClaim[],
): StaticFabOrganizationSeedCompileResult {
	const preparedSeeds = prepareSeeds(seedInputs);
	if (!preparedSeeds.valid) return preparedSeeds.result;
	const { seeds, seedByKey, topologicalSeeds, rootKey, ancestorsByKey } = preparedSeeds;

	let advancedSwitchId: number | null = null;
	map.forEachAdvancedSwitch((record) => {
		advancedSwitchId ??= record.id;
	});
	if (advancedSwitchId !== null) {
		return invalidCompilation(
			"UNSUPPORTED_ADVANCED_SWITCH",
			`Organization seed compiler v1 is rail-only; advanced switch ${advancedSwitchId} requires an explicit switch-ownership contract.`,
		);
	}

	const authoredEdges = collectAuthoredDirectedEdges(map);
	if (authoredEdges.length === 0) {
		return invalidCompilation(
			"EMPTY_MAP",
			"Organization seeds require at least one authored edge.",
		);
	}
	const authoredEdgeByKey = new Map(
		authoredEdges.map((edge) => [staticFabOrganizationEdgeKey(edge), edge]),
	);
	const claims = prepareEdgeClaims(edgeClaimInputs, seedByKey, authoredEdgeByKey);
	if (!claims.valid) return claims.result;
	for (const edge of authoredEdges) {
		const key = staticFabOrganizationEdgeKey(edge);
		if (!claims.ownerByEdgeKey.has(key)) {
			return invalidCompilation(
				"UNCLAIMED_EDGE",
				`Authored edge ${key} has no semantic provenance claim.`,
				{ edgeKey: key },
			);
		}
	}

	let modules: readonly RailModuleOwnership[];
	try {
		modules = buildRailModuleOwnershipIndex(map).modules;
	} catch (error) {
		return invalidCompilation(
			"MODULE_PARTITION_ERROR",
			error instanceof Error
				? `Rail module ownership could not be built: ${error.message}`
				: "Rail module ownership could not be built.",
		);
	}
	const partitionError = railModulePartitionError(modules, authoredEdgeByKey);
	if (partitionError) return partitionError;

	const edgesByOwnerKey = new Map<string, Map<string, DirectedRailEdge>>(
		seeds.map((seed) => [seed.key, new Map<string, DirectedRailEdge>()]),
	);
	const moduleAssignments: StaticFabOrganizationModuleAssignment[] = [];
	for (const module of modules) {
		const claimedOwnerKeys = Object.freeze(
			[
				...new Set(
					module.eraseEdges.map((edge) =>
						claims.ownerByEdgeKey.get(staticFabOrganizationEdgeKey(edge)),
					),
				),
			]
				.filter((key): key is string => key !== undefined)
				.sort(compareText),
		);
		if (claimedOwnerKeys.length === 0) {
			return invalidCompilation(
				"MODULE_PARTITION_ERROR",
				`Rail module ${module.key} has no claimed semantic provenance.`,
				{ moduleKey: module.key },
			);
		}
		const resolvedOwnerKey = resolveModuleOwner(claimedOwnerKeys, ancestorsByKey);
		if (resolvedOwnerKey === null) {
			return invalidCompilation(
				"SIBLING_MODULE_CONFLICT",
				`Rail module ${module.key} crosses owners ${claimedOwnerKeys.join(
					", ",
				)} without one claimed owner that is the unique ancestor of every other owner.`,
				{ seedKeys: claimedOwnerKeys, moduleKey: module.key },
			);
		}
		const ownedEdges = edgesByOwnerKey.get(resolvedOwnerKey);
		if (!ownedEdges) {
			return invalidCompilation(
				"MODULE_PARTITION_ERROR",
				`Resolved owner '${resolvedOwnerKey}' is not a prepared organization seed.`,
				{ seedKeys: [resolvedOwnerKey], moduleKey: module.key },
			);
		}
		for (const edge of module.eraseEdges) {
			ownedEdges.set(staticFabOrganizationEdgeKey(edge), edge);
		}
		moduleAssignments.push(
			Object.freeze({
				moduleKey: module.key,
				ownerKey: resolvedOwnerKey,
				claimedOwnerKeys,
			}),
		);
	}
	moduleAssignments.sort((left, right) => compareText(left.moduleKey, right.moduleKey));

	for (const seed of topologicalSeeds) {
		if ((edgesByOwnerKey.get(seed.key)?.size ?? 0) === 0) {
			return invalidCompilation(
				"EMPTY_SEED",
				`Organization seed '${seed.key}' owns no complete rail module after provenance closure.`,
				{ seedKeys: [seed.key] },
			);
		}
	}

	const organizationKeys = Object.freeze(topologicalSeeds.map((seed) => seed.key));
	const idByKey = new Map(topologicalSeeds.map((seed, index) => [seed.key, index + 1]));
	let organizations: StaticFabOrganizationState;
	try {
		const records = topologicalSeeds.map((seed, index) =>
			organizationRecord(seed, index + 1, idByKey, edgesByOwnerKey.get(seed.key)),
		);
		organizations = copyStaticFabOrganizationState({
			nextOrganizationId: records.length + 1,
			records: Object.freeze(records),
		});
	} catch (error) {
		return invalidCompilation(
			"STATE_INVALID",
			error instanceof Error ? error.message : "Organization state could not be materialized.",
		);
	}
	const stateError = staticFabOrganizationStateError(map, emptyPortEquipmentState(), organizations);
	if (stateError) return invalidCompilation("STATE_INVALID", stateError);

	const fingerprintSource = Object.freeze({
		rootKey,
		organizationKeys,
		organizations,
		edgeCount: authoredEdges.length,
		moduleAssignments: Object.freeze(moduleAssignments),
	});
	return Object.freeze({
		valid: true,
		kind: "compiled-static-fab-organization-seeds",
		version: STATIC_FAB_ORGANIZATION_SEED_COMPILER_VERSION,
		rootKey,
		organizationKeys,
		organizations,
		edgeCount: authoredEdges.length,
		moduleCount: moduleAssignments.length,
		moduleAssignments: fingerprintSource.moduleAssignments,
		fingerprint: staticFabOrganizationSeedCompilationFingerprint(fingerprintSource),
	});
}

/** Recompute the stable identity used to bind whole-Fab organization evidence. */
export function staticFabOrganizationSeedCompilationFingerprint(
	source: StaticFabOrganizationSeedCompilationFingerprintSource,
): string {
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings([
		"compiled-static-fab-organization-seeds",
		String(STATIC_FAB_ORGANIZATION_SEED_COMPILER_VERSION),
		source.rootKey,
	]);
	checksum.addNumbers([
		source.edgeCount,
		source.organizations.nextOrganizationId,
		source.organizations.records.length,
		source.organizationKeys.length,
		source.moduleAssignments.length,
	]);
	checksum.addStrings(source.organizationKeys);
	for (let index = 0; index < source.organizations.records.length; index += 1) {
		const record = source.organizations.records[index] as StaticFabOrganizationRecord;
		const organizationKey = source.organizationKeys[index] ?? "";
		const parentOrganizationIds = record.parentOrganizationIds ?? [];
		checksum.addNumbers([
			record.id,
			parentOrganizationIds.length,
			record.membership.railEdges.length,
			record.membership.advancedSwitchIds.length,
			record.membership.equipmentGroupIds.length,
		]);
		checksum.addNumbers(parentOrganizationIds);
		checksum.addNumbers(record.membership.advancedSwitchIds);
		checksum.addNumbers(record.membership.equipmentGroupIds);
		checksum.addStrings([
			organizationKey,
			record.kind,
			record.name,
			record.properties?.color ?? "TEAL",
			record.properties?.description ?? "",
		]);
		checksum.addStrings(record.membership.railEdges.map(staticFabOrganizationEdgeKey));
	}
	for (const assignment of source.moduleAssignments) {
		checksum.addStrings([
			assignment.moduleKey,
			assignment.ownerKey,
			...assignment.claimedOwnerKeys,
		]);
	}
	return `openfab-static-organization:v${STATIC_FAB_ORGANIZATION_SEED_COMPILER_VERSION}:${checksum.digest()}`;
}

function prepareSeeds(seedInputs: readonly StaticFabOrganizationSeed[]):
	| Readonly<{
			valid: true;
			seeds: readonly PreparedSeed[];
			seedByKey: ReadonlyMap<string, PreparedSeed>;
			topologicalSeeds: readonly PreparedSeed[];
			rootKey: string;
			ancestorsByKey: ReadonlyMap<string, ReadonlySet<string>>;
	  }>
	| Readonly<{ valid: false; result: InvalidStaticFabOrganizationSeedCompilation }> {
	if (seedInputs.length === 0) {
		return Object.freeze({
			valid: false,
			result: invalidCompilation("NO_SEEDS", "At least one organization seed is required."),
		});
	}
	const seeds: PreparedSeed[] = [];
	const seedByKey = new Map<string, PreparedSeed>();
	for (const seed of seedInputs) {
		if (
			!isPlainRecord(seed) ||
			!validSeedKey(seed.key) ||
			!STATIC_FAB_ORGANIZATION_KINDS.includes(seed.kind) ||
			!STATIC_FAB_ORGANIZATION_COLORS.includes(seed.color) ||
			!Array.isArray(seed.parentKeys)
		) {
			return Object.freeze({
				valid: false,
				result: invalidCompilation("INVALID_SEED", "Organization seed metadata is malformed.", {
					seedKeys: isPlainRecord(seed) && typeof seed.key === "string" ? [seed.key] : [],
				}),
			});
		}
		if (seedByKey.has(seed.key)) {
			return Object.freeze({
				valid: false,
				result: invalidCompilation(
					"DUPLICATE_SEED_KEY",
					`Organization seed key '${seed.key}' is duplicated.`,
					{ seedKeys: [seed.key] },
				),
			});
		}
		const parentKeys = [...seed.parentKeys];
		if (parentKeys.some((key) => !validSeedKey(key) || key === seed.key)) {
			return Object.freeze({
				valid: false,
				result: invalidCompilation(
					"INVALID_SEED",
					`Organization seed '${seed.key}' has an invalid parent key.`,
					{ seedKeys: [seed.key] },
				),
			});
		}
		parentKeys.sort(compareText);
		for (let index = 1; index < parentKeys.length; index++) {
			if (parentKeys[index - 1] === parentKeys[index]) {
				return Object.freeze({
					valid: false,
					result: invalidCompilation(
						"DUPLICATE_PARENT_KEY",
						`Organization seed '${seed.key}' repeats parent '${parentKeys[index]}'.`,
						{ seedKeys: [seed.key, parentKeys[index] as string].sort(compareText) },
					),
				});
			}
		}
		const prepared = Object.freeze({
			key: seed.key,
			kind: seed.kind,
			name: seed.name,
			parentKeys: Object.freeze(parentKeys),
			color: seed.color,
			description: seed.description,
		});
		seeds.push(prepared);
		seedByKey.set(seed.key, prepared);
	}
	for (const seed of seeds) {
		for (const parentKey of seed.parentKeys) {
			if (!seedByKey.has(parentKey)) {
				return Object.freeze({
					valid: false,
					result: invalidCompilation(
						"MISSING_PARENT",
						`Organization seed '${seed.key}' references missing parent '${parentKey}'.`,
						{ seedKeys: [seed.key, parentKey].sort(compareText) },
					),
				});
			}
		}
	}

	const roots = seeds.filter((seed) => seed.parentKeys.length === 0).sort(compareSeeds);
	if (roots.length !== 1) {
		return Object.freeze({
			valid: false,
			result: invalidCompilation(
				"UNREACHABLE_SEED",
				`Organization seed hierarchy must have exactly one root; found ${roots.length}.`,
				{ seedKeys: roots.map((seed) => seed.key) },
			),
		});
	}
	const indegree = new Map(seeds.map((seed) => [seed.key, seed.parentKeys.length]));
	const childrenByKey = new Map<string, PreparedSeed[]>();
	for (const seed of seeds) {
		for (const parentKey of seed.parentKeys) {
			const children = childrenByKey.get(parentKey) ?? [];
			children.push(seed);
			childrenByKey.set(parentKey, children);
		}
	}
	for (const children of childrenByKey.values()) children.sort(compareSeeds);
	const ready = [...roots];
	const topologicalSeeds: PreparedSeed[] = [];
	while (ready.length > 0) {
		ready.sort(compareSeeds);
		const seed = ready.shift();
		if (!seed) break;
		topologicalSeeds.push(seed);
		for (const child of childrenByKey.get(seed.key) ?? []) {
			const remaining = (indegree.get(child.key) ?? 0) - 1;
			indegree.set(child.key, remaining);
			if (remaining === 0) ready.push(child);
		}
	}
	if (topologicalSeeds.length !== seeds.length) {
		const cyclicKeys = seeds
			.filter((seed) => (indegree.get(seed.key) ?? 0) > 0)
			.map((seed) => seed.key)
			.sort(compareText);
		return Object.freeze({
			valid: false,
			result: invalidCompilation(
				"CYCLIC_HIERARCHY",
				`Organization seed hierarchy contains a cycle involving ${cyclicKeys.join(", ")}.`,
				{ seedKeys: cyclicKeys },
			),
		});
	}
	const ancestorsByKey = new Map<string, ReadonlySet<string>>();
	for (const seed of topologicalSeeds) {
		const ancestors = new Set<string>();
		for (const parentKey of seed.parentKeys) {
			ancestors.add(parentKey);
			for (const ancestorKey of ancestorsByKey.get(parentKey) ?? []) ancestors.add(ancestorKey);
		}
		ancestorsByKey.set(seed.key, ancestors);
	}
	return Object.freeze({
		valid: true,
		seeds: Object.freeze(seeds),
		seedByKey,
		topologicalSeeds: Object.freeze(topologicalSeeds),
		rootKey: roots[0]?.key as string,
		ancestorsByKey,
	});
}

function prepareEdgeClaims(
	claimInputs: readonly StaticFabOrganizationDirectedEdgeClaim[],
	seedByKey: ReadonlyMap<string, PreparedSeed>,
	authoredEdgeByKey: ReadonlyMap<string, DirectedRailEdge>,
):
	| Readonly<{ valid: true; ownerByEdgeKey: ReadonlyMap<string, string> }>
	| Readonly<{ valid: false; result: InvalidStaticFabOrganizationSeedCompilation }> {
	const ownerByEdgeKey = new Map<string, string>();
	for (const claim of claimInputs) {
		if (!isPlainRecord(claim)) {
			return Object.freeze({
				valid: false,
				result: invalidCompilation("INVALID_EDGE_CLAIM", "Directed edge claim is malformed."),
			});
		}
		const edge = claim.edge;
		if (
			!edge ||
			!validInt32(edge.from?.x) ||
			!validInt32(edge.from?.y) ||
			!validInt32(edge.to?.x) ||
			!validInt32(edge.to?.y) ||
			directionBetween(edge.from, edge.to) === null ||
			!validSeedKey(claim.ownerKey)
		) {
			return Object.freeze({
				valid: false,
				result: invalidCompilation("INVALID_EDGE_CLAIM", "Directed edge claim is malformed."),
			});
		}
		const edgeKey = staticFabOrganizationEdgeKey(edge);
		if (!seedByKey.has(claim.ownerKey)) {
			return Object.freeze({
				valid: false,
				result: invalidCompilation(
					"UNKNOWN_EDGE_OWNER",
					`Directed edge ${edgeKey} references unknown owner '${claim.ownerKey}'.`,
					{ seedKeys: [claim.ownerKey], edgeKey },
				),
			});
		}
		const existingOwner = ownerByEdgeKey.get(edgeKey);
		if (existingOwner !== undefined) {
			const conflicting = existingOwner !== claim.ownerKey;
			return Object.freeze({
				valid: false,
				result: invalidCompilation(
					conflicting ? "CONFLICTING_EDGE_CLAIM" : "DUPLICATE_EDGE_CLAIM",
					conflicting
						? `Directed edge ${edgeKey} is claimed by both '${existingOwner}' and '${claim.ownerKey}'.`
						: `Directed edge ${edgeKey} repeats owner '${claim.ownerKey}'.`,
					{
						seedKeys: [...new Set([existingOwner, claim.ownerKey])].sort(compareText),
						edgeKey,
					},
				),
			});
		}
		if (!authoredEdgeByKey.has(edgeKey)) {
			return Object.freeze({
				valid: false,
				result: invalidCompilation(
					"CLAIMED_EDGE_NOT_IN_MAP",
					`Claimed edge ${edgeKey} does not exist in the final authored map.`,
					{ seedKeys: [claim.ownerKey], edgeKey },
				),
			});
		}
		ownerByEdgeKey.set(edgeKey, claim.ownerKey);
	}
	return Object.freeze({ valid: true, ownerByEdgeKey });
}

function collectAuthoredDirectedEdges(map: TileMap): readonly DirectedRailEdge[] {
	const edges: DirectedRailEdge[] = [];
	map.forEachRail((x, y, rail) => {
		for (const direction of ALL_DIRECTIONS) {
			if ((rail.outgoing & direction) === 0) continue;
			edges.push(
				Object.freeze({
					from: Object.freeze({ x, y }),
					to: Object.freeze(moveCell({ x, y }, direction)),
				}),
			);
		}
	});
	edges.sort(compareDirectedRailEdges);
	return Object.freeze(edges);
}

function railModulePartitionError(
	modules: readonly RailModuleOwnership[],
	authoredEdgeByKey: ReadonlyMap<string, DirectedRailEdge>,
): InvalidStaticFabOrganizationSeedCompilation | null {
	const moduleKeyByEdge = new Map<string, string>();
	for (const module of modules) {
		if (module.eraseEdges.length === 0) {
			return invalidCompilation(
				"MODULE_PARTITION_ERROR",
				`Rail module ${module.key} has no directed ownership edge.`,
				{ moduleKey: module.key },
			);
		}
		for (const edge of module.eraseEdges) {
			const edgeKey = staticFabOrganizationEdgeKey(edge);
			if (!authoredEdgeByKey.has(edgeKey)) {
				return invalidCompilation(
					"MODULE_PARTITION_ERROR",
					`Rail module ${module.key} contains non-authored edge ${edgeKey}.`,
					{ moduleKey: module.key, edgeKey },
				);
			}
			const previousModuleKey = moduleKeyByEdge.get(edgeKey);
			if (previousModuleKey !== undefined) {
				return invalidCompilation(
					"MODULE_PARTITION_ERROR",
					`Authored edge ${edgeKey} belongs to both rail modules ${previousModuleKey} and ${module.key}.`,
					{ moduleKey: module.key, edgeKey },
				);
			}
			moduleKeyByEdge.set(edgeKey, module.key);
		}
	}
	for (const edgeKey of authoredEdgeByKey.keys()) {
		if (!moduleKeyByEdge.has(edgeKey)) {
			return invalidCompilation(
				"MODULE_PARTITION_ERROR",
				`Authored edge ${edgeKey} does not belong to one complete rail module.`,
				{ edgeKey },
			);
		}
	}
	return null;
}

function resolveModuleOwner(
	claimedOwnerKeys: readonly string[],
	ancestorsByKey: ReadonlyMap<string, ReadonlySet<string>>,
): string | null {
	if (claimedOwnerKeys.length === 1) return claimedOwnerKeys[0] as string;
	const candidates = claimedOwnerKeys.filter((candidateKey) =>
		claimedOwnerKeys.every(
			(otherKey) =>
				otherKey === candidateKey || (ancestorsByKey.get(otherKey)?.has(candidateKey) ?? false),
		),
	);
	return candidates.length === 1 ? (candidates[0] as string) : null;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function organizationRecord(
	seed: PreparedSeed,
	id: number,
	idByKey: ReadonlyMap<string, number>,
	edges: ReadonlyMap<string, DirectedRailEdge> | undefined,
): StaticFabOrganizationRecord {
	return Object.freeze({
		id,
		kind: seed.kind,
		name: seed.name,
		parentOrganizationIds: Object.freeze(
			seed.parentKeys
				.map((parentKey) => idByKey.get(parentKey))
				.filter((parentId): parentId is number => parentId !== undefined)
				.sort((left, right) => left - right),
		),
		properties: Object.freeze({ description: seed.description, color: seed.color }),
		membership: Object.freeze({
			railEdges: Object.freeze([...(edges?.values() ?? [])].sort(compareDirectedRailEdges)),
			advancedSwitchIds: Object.freeze([]),
			equipmentGroupIds: Object.freeze([]),
		}),
	});
}

function invalidCompilation(
	code: StaticFabOrganizationSeedCompileErrorCode,
	message: string,
	context: Readonly<{
		seedKeys?: readonly string[];
		moduleKey?: string | null;
		edgeKey?: string | null;
	}> = {},
): InvalidStaticFabOrganizationSeedCompilation {
	const error = Object.freeze({
		code,
		message,
		seedKeys: Object.freeze([...(context.seedKeys ?? [])].sort(compareText)),
		moduleKey: context.moduleKey ?? null,
		edgeKey: context.edgeKey ?? null,
	});
	return Object.freeze({
		valid: false,
		kind: "invalid-static-fab-organization-seeds",
		version: STATIC_FAB_ORGANIZATION_SEED_COMPILER_VERSION,
		reason: message,
		error,
	});
}

function validSeedKey(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		value.length <= 160 &&
		value === value.trim() &&
		!hasAsciiControlCharacter(value)
	);
}

function hasAsciiControlCharacter(value: string): boolean {
	for (let index = 0; index < value.length; index++) {
		const code = value.charCodeAt(index);
		if (code <= 0x1f || code === 0x7f) return true;
	}
	return false;
}

function validInt32(value: unknown): value is number {
	return (
		typeof value === "number" &&
		Number.isInteger(value) &&
		value >= -0x80000000 &&
		value <= 0x7fffffff
	);
}

function compareSeeds(left: PreparedSeed, right: PreparedSeed): number {
	return compareText(left.key, right.key);
}

function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}
