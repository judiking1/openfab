import { emptyPortEquipmentState } from "../core/EquipmentGroup";
import { analyzeRailNetwork } from "../core/network";
import { OrderedTypedChecksum } from "../core/OrderedTypedChecksum";
import {
	type ProductionBayBuildStepOwner,
	type ProductionBayModulePlan,
	type ProductionBayModuleRequest,
	planProductionBayModule,
} from "../core/ProductionBayModulePlanner";
import {
	buildRailModuleOwnershipIndex,
	type DirectedRailEdge,
	type RailModuleOwnership,
} from "../core/RailModuleOwnership";
import { planRailRouteBatch } from "../core/RailTemplateCatalog";
import {
	compareDirectedRailEdges,
	copyStaticFabOrganizationState,
	type StaticFabOrganizationColor,
	type StaticFabOrganizationMembership,
	type StaticFabOrganizationRecord,
	staticFabOrganizationEdgeKey,
} from "../core/StaticFabOrganization";
import {
	captureStaticFabOrganizationBundle,
	type StaticFabOrganizationBundle,
} from "../core/StaticFabOrganizationBundle";
import { staticFabOrganizationBundleFingerprint } from "../core/StaticFabOrganizationBundlePlacement";
import { TileMap } from "../core/TileMap";
import { checksumRailMap } from "../worker/RailMirrorChecksum";
import { checksumRailPhysicalLayout } from "../worker/RailPhysicalLayout";
import { compilePhysicalRail } from "./PhysicalRailCompiler";
import { createRailProjectReadiness, type RailProjectReadiness } from "./RailProjectReadiness";

export const PRODUCTION_BAY_MODULE_CERTIFICATION_VERSION = 2 as const;

export interface CertifiedProductionBayModule {
	readonly kind: "certified-production-bay-module";
	readonly version: typeof PRODUCTION_BAY_MODULE_CERTIFICATION_VERSION;
	readonly placementReady: true;
	readonly reason: string;
	readonly plan: ProductionBayModulePlan;
	readonly topology: Readonly<{
		status: "closed";
		cells: number;
		edges: number;
		components: 1;
		strongComponents: 1;
		openEnds: 0;
		unsafeJunctions: 0;
	}>;
	readonly physical: Readonly<{
		valid: true;
		pathCount: number;
		strongComponents: 1;
		openPaths: 0;
		invalidPaths: 0;
		clearanceIssueCount: 0;
	}>;
	readonly readiness: RailProjectReadiness;
	readonly organizationBundle: StaticFabOrganizationBundle;
	readonly authoredChecksum: string;
	readonly physicalFingerprint: string;
	readonly fingerprint: string;
}

/**
 * Turn a pure Bay geometry plan into one portable, placement-ready authoring bundle. All authored,
 * physical, hierarchy, and ownership checks run over the same prospective map before publication.
 */
export function certifyProductionBayModule(
	request: ProductionBayModuleRequest,
): CertifiedProductionBayModule {
	const plan = planProductionBayModule(request);
	const map = new TileMap();
	const construction = planRailRouteBatch(map, plan.buildRoutes, "free-closed-primary");
	if (!construction.valid) {
		throw new Error(`Production Bay topology planning failed: ${construction.reason}`);
	}
	if (construction.newEdges !== plan.newEdges) {
		throw new Error(
			`Production Bay edge contract mismatch: planned ${plan.newEdges}, materialized ${construction.newEdges}.`,
		);
	}
	for (const mutation of construction.mutations) {
		map.setEncoded(mutation.x, mutation.y, mutation.after);
	}

	const analysis = analyzeRailNetwork(map);
	const organizations = createProductionBayOrganizationState(map, plan);
	const emptyEquipment = emptyPortEquipmentState();
	const authoredChecksum = checksumRailMap(map, emptyEquipment, organizations);
	const physical = compilePhysicalRail(map);
	const readiness = createRailProjectReadiness(analysis, physical, authoredChecksum);
	if (!readiness.ready) {
		throw new Error(
			`Production Bay readiness certification failed: ${readiness.issues.map((issue) => issue.code).join(", ") || "UNKNOWN"}.`,
		);
	}
	const captured = captureStaticFabOrganizationBundle(
		map,
		emptyEquipment,
		0,
		organizations,
		[1],
		"EFFECTIVE",
	);
	if (!captured.valid) {
		throw new Error(`Production Bay organization capture failed: ${captured.reason}`);
	}
	const physicalFingerprint = checksumRailPhysicalLayout(physical);
	const topology = Object.freeze({
		status: "closed" as const,
		cells: analysis.cells,
		edges: analysis.edges,
		components: 1 as const,
		strongComponents: 1 as const,
		openEnds: 0 as const,
		unsafeJunctions: 0 as const,
	});
	const physicalSummary = Object.freeze({
		valid: true as const,
		pathCount: readiness.summary.physicalPaths,
		strongComponents: 1 as const,
		openPaths: 0 as const,
		invalidPaths: 0 as const,
		clearanceIssueCount: 0 as const,
	});
	const withoutFingerprint = Object.freeze({
		kind: "certified-production-bay-module" as const,
		version: PRODUCTION_BAY_MODULE_CERTIFICATION_VERSION,
		placementReady: true as const,
		reason:
			"Production Bay topology, physical paths, clearance, hierarchy, and ownership are certified.",
		plan,
		topology,
		physical: physicalSummary,
		readiness,
		organizationBundle: captured.bundle,
		authoredChecksum,
		physicalFingerprint,
	});
	return Object.freeze({
		...withoutFingerprint,
		fingerprint: certificationFingerprint(withoutFingerprint),
	});
}

function createProductionBayOrganizationState(map: TileMap, plan: ProductionBayModulePlan) {
	const modules = buildRailModuleOwnershipIndex(map).modules;
	const semanticOwnerByEdge = buildSemanticEdgeOwnerIndex(plan);
	const modulesByLoopId = new Map<string, RailModuleOwnership[]>();
	const bayModules: RailModuleOwnership[] = [];
	const resolvedEdgeKeys = new Set<string>();
	for (const module of modules) {
		const owners = new Set<ProductionBayBuildStepOwner>();
		for (const edge of module.eraseEdges) {
			const key = staticFabOrganizationEdgeKey(edge);
			const owner = semanticOwnerByEdge.get(key);
			if (!owner) {
				throw new Error(`Production Bay module ${module.key} contains unproven edge ${key}.`);
			}
			owners.add(owner);
			resolvedEdgeKeys.add(key);
		}
		if (owners.size === 0) {
			throw new Error(`Production Bay module ${module.key} has no semantic edge provenance.`);
		}
		if (owners.has("BAY")) {
			bayModules.push(module);
			continue;
		}
		if (owners.size !== 1) {
			throw new Error(
				`Production Bay module ${module.key} crosses multiple Process Loop owners without a Bay adapter.`,
			);
		}
		const owner = [...owners][0] as Exclude<ProductionBayBuildStepOwner, "BAY">;
		const owned = modulesByLoopId.get(owner) ?? [];
		owned.push(module);
		modulesByLoopId.set(owner, owned);
	}
	if (resolvedEdgeKeys.size !== semanticOwnerByEdge.size) {
		throw new Error(
			`Production Bay ownership resolved ${resolvedEdgeKeys.size}/${semanticOwnerByEdge.size} semantic edges.`,
		);
	}
	for (const loop of plan.processLoops) {
		if ((modulesByLoopId.get(loop.id) ?? []).length === 0) {
			throw new Error(`Production Bay Process Loop ${loop.id} has no directly owned modules.`);
		}
	}
	const records: StaticFabOrganizationRecord[] = [
		organizationRecord(1, "BAY", productionBayName(plan), [], bayModules, "CYAN"),
		...plan.processLoops.map((loop, index) =>
			organizationRecord(
				index + 2,
				"AISLE",
				`Process Loop ${String.fromCharCode(65 + index)}`,
				[1],
				modulesByLoopId.get(loop.id) ?? [],
				index === 0 ? "TEAL" : "BLUE",
			),
		),
	];
	return copyStaticFabOrganizationState({
		nextOrganizationId: records.length + 1,
		records: Object.freeze(records),
	});
}

function buildSemanticEdgeOwnerIndex(
	plan: ProductionBayModulePlan,
): ReadonlyMap<string, ProductionBayBuildStepOwner> {
	const owners = new Map<string, ProductionBayBuildStepOwner>();
	for (const step of plan.buildSteps) {
		for (let index = 0; index < step.route.length - 1; index++) {
			const from = step.route[index];
			const to = step.route[index + 1];
			if (!from || !to) throw new Error(`Production Bay build step ${step.id} is malformed.`);
			const key = staticFabOrganizationEdgeKey({ from, to });
			const existing = owners.get(key);
			if (existing) {
				throw new Error(
					`Production Bay edge ${key} is claimed by both ${existing} and ${step.owner}.`,
				);
			}
			owners.set(key, step.owner);
		}
	}
	if (owners.size !== plan.newEdges) {
		throw new Error(
			`Production Bay semantic provenance covers ${owners.size}/${plan.newEdges} planned edges.`,
		);
	}
	return owners;
}

function organizationRecord(
	id: number,
	kind: StaticFabOrganizationRecord["kind"],
	name: string,
	parentOrganizationIds: readonly number[],
	modules: readonly RailModuleOwnership[],
	color: StaticFabOrganizationColor,
): StaticFabOrganizationRecord {
	return Object.freeze({
		id,
		kind,
		name,
		parentOrganizationIds: Object.freeze([...parentOrganizationIds]),
		properties: Object.freeze({ description: "", color }),
		membership: membershipFromModules(modules),
	});
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

function productionBayName(plan: ProductionBayModulePlan): string {
	return plan.specification.processLoopCount === 1
		? "Single-loop Production Bay"
		: "Twin-loop Production Bay";
}

function certificationFingerprint(
	artifact: Omit<CertifiedProductionBayModule, "fingerprint">,
): string {
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings([
		artifact.kind,
		artifact.plan.fingerprint,
		artifact.authoredChecksum,
		artifact.physicalFingerprint,
		artifact.readiness.fingerprint,
		staticFabOrganizationBundleFingerprint(artifact.organizationBundle),
	]);
	checksum.addNumbers([
		artifact.version,
		artifact.topology.cells,
		artifact.topology.edges,
		artifact.physical.pathCount,
		artifact.organizationBundle.sourceModuleCount,
		artifact.organizationBundle.railEdges.length,
		artifact.organizationBundle.organizations.length,
	]);
	return checksum.digest();
}
