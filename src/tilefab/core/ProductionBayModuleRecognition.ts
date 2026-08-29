import { OrderedTypedChecksum } from "./OrderedTypedChecksum";
import {
	type PRODUCTION_BAY_MODULE_GATEWAY_LENGTH_PROJECTION_POLICY,
	PRODUCTION_BAY_MODULE_MINIMUM_GATEWAY_LENGTH_METERS,
	type ProductionBayBuildStepOwner,
	type ProductionBayInternalFlowPattern,
	type ProductionBayModulePlan,
	type ProductionBayModuleRequest,
	planProductionBayModule,
} from "./ProductionBayModulePlanner";
import {
	buildRailModuleOwnershipIndex,
	type DirectedRailEdge,
	type RailModuleOwnership,
} from "./RailModuleOwnership";
import {
	ALL_DIRECTIONS,
	DIR_E,
	DIR_S,
	directionBetween,
	moveCell,
	oppositeDirection,
} from "./railShape";
import {
	deriveStaticFabOrganizationSemanticRoles,
	resolveStaticFabOrganizationCoverage,
	type StaticFabOrganizationRecord,
	type StaticFabOrganizationState,
	staticFabOrganizationEdgeKey,
	staticFabOrganizationParentIds,
} from "./StaticFabOrganization";
import { type Cell, encodeRailCell, TileMap } from "./TileMap";

const SUPPORTED_GATEWAY_LENGTH_PROJECTION_POLICY: typeof PRODUCTION_BAY_MODULE_GATEWAY_LENGTH_PROJECTION_POLICY =
	Object.freeze({
		version: 1,
		productionBayModulePlanVersion: 2,
		productionBayModuleTopologyPolicy: "four-adapter-v1",
		pairedRailCorridorPlanVersion: 1,
		authoredProjectionInvariant: true,
	});

type ProcessLoopId = "process-loop-a" | "process-loop-b";

export type ProductionBayModuleRecognitionIssueCode =
	| "INVALID_ORGANIZATION_STATE"
	| "BAY_NOT_FOUND"
	| "NOT_DETACHED_TWIN_BAY"
	| "INVALID_BAY_MEMBERSHIP"
	| "UNRECOGNIZED_BAY_GEOMETRY"
	| "AMBIGUOUS_BAY_GEOMETRY"
	| "NON_EQUIVALENT_SPECIFICATION_ALIASES";

export interface ProductionBayModuleRecognition {
	readonly plan: ProductionBayModulePlan;
	readonly bayOrganizationId: number;
	readonly processLoopOrganizationIdsByLoopId: Readonly<Record<ProcessLoopId, number>>;
	readonly authoredDirectedEdgeKeys: readonly string[];
	readonly authoredProjectionFingerprint: string;
	readonly specificationAliasCount: number;
	readonly gatewayLengthMetersAliasDomain: Readonly<{
		readonly minimum: number;
		readonly maximum: number;
	}>;
}

export type ProductionBayModuleRecognitionResult =
	| Readonly<{
			readonly valid: true;
			readonly recognition: ProductionBayModuleRecognition;
	  }>
	| Readonly<{
			readonly valid: false;
			readonly issueCode: ProductionBayModuleRecognitionIssueCode;
			readonly reason: string;
	  }>;

interface AxisAlignedBounds {
	readonly minX: number;
	readonly minY: number;
	readonly maxX: number;
	readonly maxY: number;
}

interface DerivedRequestGeometry {
	readonly anchor: Cell;
	readonly outerLengthMeters: number;
	readonly outerDepthMeters: number;
	readonly shellMarginMeters: number;
	readonly processLoopGapMeters: number;
	readonly pose: ProductionBayModuleRequest["pose"];
}

interface Projection {
	readonly edgeKeys: readonly string[];
	readonly semanticOwnerKeys: readonly string[];
}

interface MatchedCandidate {
	readonly plan: ProductionBayModulePlan;
	readonly requestGeometry: DerivedRequestGeometry;
	readonly processLoopOrganizationIdsByLoopId: Readonly<Record<ProcessLoopId, number>>;
}

/**
 * Reconstruct runtime-only Production Bay meaning from current authored truth. No catalog
 * provenance, organization name, organization id convention, or child array position participates
 * in recognition.
 */
export function recognizeProductionBayModule(
	map: TileMap,
	organizations: StaticFabOrganizationState,
	bayOrganizationId: number,
): ProductionBayModuleRecognitionResult {
	const hierarchy = exactDetachedTwinHierarchy(organizations, bayOrganizationId);
	if (!hierarchy.valid) return hierarchy.result;

	const coverage = resolveStaticFabOrganizationCoverage(organizations, bayOrganizationId);
	if (!coverage) {
		return invalidRecognition("BAY_NOT_FOUND", `Bay organization ${bayOrganizationId} is missing.`);
	}
	if (coverage.effective.advancedSwitchIds.length !== 0) {
		return invalidRecognition(
			"INVALID_BAY_MEMBERSHIP",
			"A Production Bay effective membership cannot contain advanced switches.",
		);
	}

	const authoredDirectedEdgeKeys = sortedUniqueEdgeKeys(coverage.effective.railEdges);
	if (authoredDirectedEdgeKeys.length === 0) {
		return invalidRecognition(
			"INVALID_BAY_MEMBERSHIP",
			"The Bay effective membership contains no directed rail edges.",
		);
	}
	const membershipError = exactDetachedMembershipError(
		map,
		hierarchy.bay,
		hierarchy.processLoops,
		authoredDirectedEdgeKeys,
	);
	if (membershipError) {
		return invalidRecognition("INVALID_BAY_MEMBERSHIP", membershipError);
	}
	const componentError = exactBayComponentError(
		map,
		coverage.effective.railEdges,
		authoredDirectedEdgeKeys,
	);
	if (componentError) {
		return invalidRecognition("INVALID_BAY_MEMBERSHIP", componentError);
	}

	const sourceEdges = coverage.effective.railEdges;
	const requestGeometries = deriveRequestGeometries(sourceEdges, hierarchy.processLoops);
	if (requestGeometries.length === 0) {
		return invalidRecognition(
			"UNRECOGNIZED_BAY_GEOMETRY",
			"The Bay and its two Process Loop memberships do not form one supported Twin Bay geometry.",
		);
	}

	const authoredEdgeKeySet = new Set(authoredDirectedEdgeKeys);
	const bayMap = materializeDirectedEdgeMap(coverage.effective.railEdges);
	const modules = buildRailModuleOwnershipIndex(bayMap).modules.filter(
		(module) =>
			module.eraseEdges.length > 0 &&
			module.eraseEdges.every((edge) => authoredEdgeKeySet.has(staticFabOrganizationEdgeKey(edge))),
	);
	let candidates = collectMatchingCandidates(
		requestGeometries.slice(0, 1),
		authoredDirectedEdgeKeys,
		modules,
		hierarchy.bay,
		hierarchy.processLoops,
	);
	// World-positive lateral is the canonical representation. An alternating Bay can make that
	// representation impossible because only its opposite-lateral Process Loop follows shell flow;
	// in that asymmetric case alone, admit the reflected geometric representation.
	if (candidates.length === 0 && requestGeometries.length > 1) {
		candidates = collectMatchingCandidates(
			requestGeometries.slice(1),
			authoredDirectedEdgeKeys,
			modules,
			hierarchy.bay,
			hierarchy.processLoops,
		);
	}
	if (candidates.length === 0) {
		return invalidRecognition(
			"UNRECOGNIZED_BAY_GEOMETRY",
			"The exact Bay edge set and semantic module ownership do not match a supported Twin Production Bay.",
		);
	}
	if (candidates.length !== 1) {
		return invalidRecognition(
			"AMBIGUOUS_BAY_GEOMETRY",
			`The authored Bay has ${candidates.length} non-equivalent Production Bay interpretations.`,
		);
	}

	const candidate = candidates[0] as MatchedCandidate;
	const aliases = verifyGatewayLengthAliases(candidate, authoredDirectedEdgeKeys);
	if (!aliases.valid) return aliases.result;
	const authoredProjectionFingerprint = projectionFingerprint(authoredDirectedEdgeKeys);
	return Object.freeze({
		valid: true as const,
		recognition: Object.freeze({
			plan: candidate.plan,
			bayOrganizationId,
			processLoopOrganizationIdsByLoopId: candidate.processLoopOrganizationIdsByLoopId,
			authoredDirectedEdgeKeys: Object.freeze([...authoredDirectedEdgeKeys]),
			authoredProjectionFingerprint,
			specificationAliasCount: aliases.count,
			gatewayLengthMetersAliasDomain: Object.freeze({
				minimum: aliases.minimum,
				maximum: aliases.maximum,
			}),
		}),
	});
}

type HierarchyResult =
	| Readonly<{
			readonly valid: true;
			readonly bay: StaticFabOrganizationRecord;
			readonly processLoops: readonly [StaticFabOrganizationRecord, StaticFabOrganizationRecord];
	  }>
	| Readonly<{ readonly valid: false; readonly result: ProductionBayModuleRecognitionResult }>;

function exactDetachedTwinHierarchy(
	organizations: StaticFabOrganizationState,
	bayOrganizationId: number,
): HierarchyResult {
	const recordsById = new Map<number, StaticFabOrganizationRecord>();
	for (const record of organizations.records) {
		if (recordsById.has(record.id)) {
			return Object.freeze({
				valid: false as const,
				result: invalidRecognition(
					"INVALID_ORGANIZATION_STATE",
					`Organization id ${record.id} occurs more than once.`,
				),
			});
		}
		recordsById.set(record.id, record);
	}
	const bay = recordsById.get(bayOrganizationId);
	if (!bay) {
		return Object.freeze({
			valid: false as const,
			result: invalidRecognition(
				"BAY_NOT_FOUND",
				`Bay organization ${bayOrganizationId} is missing.`,
			),
		});
	}
	const roles = deriveStaticFabOrganizationSemanticRoles(organizations);
	const directChildren = organizations.records.filter((record) =>
		staticFabOrganizationParentIds(record).includes(bay.id),
	);
	const exactChildren =
		directChildren.length === 2 &&
		directChildren.every(
			(record) =>
				roles.get(record.id) === "PROCESS_LOOP" &&
				staticFabOrganizationParentIds(record).length === 1,
		);
	const coverage = resolveStaticFabOrganizationCoverage(organizations, bay.id);
	if (
		roles.get(bay.id) !== "BAY" ||
		staticFabOrganizationParentIds(bay).length !== 0 ||
		!exactChildren ||
		!coverage ||
		coverage.descendantOrganizationIds.length !== 2
	) {
		return Object.freeze({
			valid: false as const,
			result: invalidRecognition(
				"NOT_DETACHED_TWIN_BAY",
				"Recognition requires one detached Bay with exactly two direct Process Loop children and no other descendants.",
			),
		});
	}
	return Object.freeze({
		valid: true as const,
		bay,
		processLoops: Object.freeze([
			directChildren[0] as StaticFabOrganizationRecord,
			directChildren[1] as StaticFabOrganizationRecord,
		] as const),
	});
}

function exactDetachedMembershipError(
	map: TileMap,
	bay: StaticFabOrganizationRecord,
	processLoops: readonly StaticFabOrganizationRecord[],
	authoredDirectedEdgeKeys: readonly string[],
): string | null {
	const claimed = new Set<string>();
	for (const record of [bay, ...processLoops]) {
		if (record.membership.advancedSwitchIds.length !== 0) {
			return `Organization ${record.id} contains unsupported advanced-switch membership.`;
		}
		if (record.membership.railEdges.length === 0) {
			return `Organization ${record.id} has no direct rail membership.`;
		}
		for (const edge of record.membership.railEdges) {
			const key = staticFabOrganizationEdgeKey(edge);
			if (claimed.has(key)) {
				return `Directed edge ${key} is directly claimed by more than one Bay organization.`;
			}
			claimed.add(key);
			if (!directedEdgeExists(map, edge)) {
				return `Directed edge ${key} is missing from the detached TileMap.`;
			}
		}
	}
	if (!sameStrings([...claimed].sort(), authoredDirectedEdgeKeys)) {
		return "The Bay direct memberships do not partition its effective directed-edge union exactly.";
	}
	return null;
}

function exactBayComponentError(
	map: TileMap,
	authoredEdges: readonly DirectedRailEdge[],
	authoredDirectedEdgeKeys: readonly string[],
): string | null {
	const first = authoredEdges[0];
	if (!first) return "The Bay effective membership contains no component seed edge.";
	const visitedCells = new Set<string>();
	const componentEdgeKeys = new Set<string>();
	const pending: Cell[] = [first.from];
	for (let offset = 0; offset < pending.length; offset++) {
		const cell = pending[offset] as Cell;
		const cellIdentity = `${cell.x}:${cell.y}`;
		if (visitedCells.has(cellIdentity)) continue;
		visitedCells.add(cellIdentity);
		if (map.getAdvancedSwitchOwningCell(cell.x, cell.y)) {
			return `The Bay rail component crosses an advanced switch at ${cellIdentity}.`;
		}
		const rail = map.getRail(cell.x, cell.y);
		for (const direction of ALL_DIRECTIONS) {
			const neighbor = moveCell(cell, direction);
			const neighborRail = map.getRail(neighbor.x, neighbor.y);
			let connected = false;
			if (
				(rail.outgoing & direction) !== 0 &&
				(neighborRail.incoming & oppositeDirection(direction)) !== 0
			) {
				componentEdgeKeys.add(staticFabOrganizationEdgeKey({ from: cell, to: neighbor }));
				connected = true;
			}
			if (
				(rail.incoming & direction) !== 0 &&
				(neighborRail.outgoing & oppositeDirection(direction)) !== 0
			) {
				componentEdgeKeys.add(staticFabOrganizationEdgeKey({ from: neighbor, to: cell }));
				connected = true;
			}
			if (connected && !visitedCells.has(`${neighbor.x}:${neighbor.y}`)) pending.push(neighbor);
		}
	}
	if (!sameStrings([...componentEdgeKeys].sort(), authoredDirectedEdgeKeys)) {
		return "The Bay effective edge union is not exactly one disconnected authored rail component.";
	}
	return null;
}

function directedEdgeExists(map: TileMap, edge: DirectedRailEdge): boolean {
	const direction = directionBetween(edge.from, edge.to);
	if (direction === null) return false;
	return (
		(map.getRail(edge.from.x, edge.from.y).outgoing & direction) !== 0 &&
		(map.getRail(edge.to.x, edge.to.y).incoming & oppositeDirection(direction)) !== 0
	);
}

function materializeDirectedEdgeMap(edges: readonly DirectedRailEdge[]): TileMap {
	const cells = new Map<string, { readonly cell: Cell; incoming: number; outgoing: number }>();
	const stateFor = (cell: Cell): { readonly cell: Cell; incoming: number; outgoing: number } => {
		const identity = `${cell.x}:${cell.y}`;
		const existing = cells.get(identity);
		if (existing) return existing;
		const created = { cell: Object.freeze({ x: cell.x, y: cell.y }), incoming: 0, outgoing: 0 };
		cells.set(identity, created);
		return created;
	};
	for (const edge of edges) {
		const direction = directionBetween(edge.from, edge.to);
		if (direction === null) continue;
		stateFor(edge.from).outgoing |= direction;
		stateFor(edge.to).incoming |= oppositeDirection(direction);
	}
	const map = new TileMap();
	for (const state of cells.values()) {
		map.setEncoded(state.cell.x, state.cell.y, encodeRailCell(state));
	}
	return map;
}

function deriveRequestGeometries(
	bayEdges: readonly DirectedRailEdge[],
	processLoops: readonly StaticFabOrganizationRecord[],
): readonly DerivedRequestGeometry[] {
	const outer = edgeBounds(bayEdges);
	const first = edgeBounds(processLoops[0]?.membership.railEdges ?? []);
	const second = edgeBounds(processLoops[1]?.membership.railEdges ?? []);
	if (!outer || !first || !second) return Object.freeze([]);

	if (
		first.minX === second.minX &&
		first.maxX === second.maxX &&
		(first.maxY < second.minY || second.maxY < first.minY)
	) {
		const ordered = first.minY < second.minY ? [first, second] : [second, first];
		const near = ordered[0] as AxisAlignedBounds;
		const far = ordered[1] as AxisAlignedBounds;
		const shellMargin = commonShellMargin([
			near.minX - outer.minX,
			outer.maxX - near.maxX,
			near.minY - outer.minY,
			outer.maxY - far.maxY,
		]);
		if (shellMargin === null || far.maxX - far.minX !== near.maxX - near.minX) {
			return Object.freeze([]);
		}
		const processLoopDepth = near.maxY - near.minY;
		if (far.maxY - far.minY !== processLoopDepth) return Object.freeze([]);
		return geometryPair(
			{
				anchor: Object.freeze({ x: outer.minX, y: outer.minY }),
				outerLengthMeters: outer.maxX - outer.minX,
				outerDepthMeters: outer.maxY - outer.minY,
				shellMarginMeters: shellMargin,
				processLoopGapMeters: far.minY - near.maxY,
				pose: Object.freeze({ forward: DIR_E, side: "right" as const }),
			},
			Object.freeze({ x: outer.minX, y: outer.maxY }),
			"left",
		);
	}

	if (
		first.minY === second.minY &&
		first.maxY === second.maxY &&
		(first.maxX < second.minX || second.maxX < first.minX)
	) {
		const ordered = first.minX < second.minX ? [first, second] : [second, first];
		const near = ordered[0] as AxisAlignedBounds;
		const far = ordered[1] as AxisAlignedBounds;
		const shellMargin = commonShellMargin([
			near.minY - outer.minY,
			outer.maxY - near.maxY,
			near.minX - outer.minX,
			outer.maxX - far.maxX,
		]);
		if (shellMargin === null || far.maxY - far.minY !== near.maxY - near.minY) {
			return Object.freeze([]);
		}
		const processLoopDepth = near.maxX - near.minX;
		if (far.maxX - far.minX !== processLoopDepth) return Object.freeze([]);
		return geometryPair(
			{
				anchor: Object.freeze({ x: outer.minX, y: outer.minY }),
				outerLengthMeters: outer.maxY - outer.minY,
				outerDepthMeters: outer.maxX - outer.minX,
				shellMarginMeters: shellMargin,
				processLoopGapMeters: far.minX - near.maxX,
				pose: Object.freeze({ forward: DIR_S, side: "left" as const }),
			},
			Object.freeze({ x: outer.maxX, y: outer.minY }),
			"right",
		);
	}
	return Object.freeze([]);
}

function geometryPair(
	canonical: DerivedRequestGeometry,
	reflectedAnchor: Cell,
	reflectedSide: "left" | "right",
): readonly DerivedRequestGeometry[] {
	return Object.freeze([
		Object.freeze(canonical),
		Object.freeze({
			...canonical,
			anchor: reflectedAnchor,
			pose: Object.freeze({ ...canonical.pose, side: reflectedSide }),
		}),
	]);
}

function commonShellMargin(values: readonly number[]): number | null {
	const first = values[0];
	if (!Number.isSafeInteger(first) || first === undefined || first <= 0) return null;
	return values.every((value) => value === first) ? first : null;
}

function collectMatchingCandidates(
	geometries: readonly DerivedRequestGeometry[],
	authoredDirectedEdgeKeys: readonly string[],
	modules: readonly RailModuleOwnership[],
	bay: StaticFabOrganizationRecord,
	processLoops: readonly StaticFabOrganizationRecord[],
): readonly MatchedCandidate[] {
	const candidates: MatchedCandidate[] = [];
	for (const requestGeometry of geometries) {
		for (const flow of ["forward", "reverse"] as const) {
			for (const internalFlowPattern of ["alternating", "co-rotating"] as const) {
				const plan = tryPlan(requestGeometry, flow, internalFlowPattern, 1);
				if (!plan) continue;
				const projection = authoredProjection(plan);
				if (!projection || !sameStrings(projection.edgeKeys, authoredDirectedEdgeKeys)) continue;
				const mapping = mapSemanticOwnership(plan, modules, bay, processLoops);
				if (!mapping) continue;
				candidates.push(
					Object.freeze({
						plan,
						requestGeometry,
						processLoopOrganizationIdsByLoopId: mapping,
					}),
				);
			}
		}
	}
	return Object.freeze(candidates);
}

function tryPlan(
	geometry: DerivedRequestGeometry,
	flow: "forward" | "reverse",
	internalFlowPattern: ProductionBayInternalFlowPattern,
	gatewayLengthMeters: number,
): ProductionBayModulePlan | null {
	try {
		return planProductionBayModule({
			...geometry,
			gatewayLengthMeters,
			processLoopCount: 2,
			internalFlowPattern,
			pose: { ...geometry.pose, flow },
		});
	} catch {
		return null;
	}
}

function authoredProjection(plan: ProductionBayModulePlan): Projection | null {
	const ownerByEdge = new Map<string, ProductionBayBuildStepOwner>();
	for (const step of plan.buildSteps) {
		for (let index = 0; index < step.route.length - 1; index++) {
			const from = step.route[index];
			const to = step.route[index + 1];
			if (!from || !to) return null;
			const key = staticFabOrganizationEdgeKey({ from, to });
			if (ownerByEdge.has(key)) return null;
			ownerByEdge.set(key, step.owner);
		}
	}
	if (ownerByEdge.size !== plan.newEdges) return null;
	const edgeKeys = Object.freeze([...ownerByEdge.keys()].sort());
	const semanticOwnerKeys = Object.freeze(
		[...ownerByEdge].map(([key, owner]) => `${owner}:${key}`).sort(),
	);
	return Object.freeze({ edgeKeys, semanticOwnerKeys });
}

function mapSemanticOwnership(
	plan: ProductionBayModulePlan,
	modules: readonly RailModuleOwnership[],
	bay: StaticFabOrganizationRecord,
	processLoops: readonly StaticFabOrganizationRecord[],
): Readonly<Record<ProcessLoopId, number>> | null {
	const projection = authoredProjection(plan);
	if (!projection) return null;
	const ownerByEdge = new Map<string, ProductionBayBuildStepOwner>();
	for (const semanticOwnerKey of projection.semanticOwnerKeys) {
		const separator = semanticOwnerKey.indexOf(":");
		if (separator < 0) return null;
		const owner = semanticOwnerKey.slice(0, separator) as ProductionBayBuildStepOwner;
		ownerByEdge.set(semanticOwnerKey.slice(separator + 1), owner);
	}
	const expected = new Map<ProductionBayBuildStepOwner, Set<string>>([
		["BAY", new Set<string>()],
		["process-loop-a", new Set<string>()],
		["process-loop-b", new Set<string>()],
	]);
	const resolved = new Set<string>();
	for (const module of modules) {
		const owners = new Set<ProductionBayBuildStepOwner>();
		for (const edge of module.eraseEdges) {
			const key = staticFabOrganizationEdgeKey(edge);
			const owner = ownerByEdge.get(key);
			if (!owner) return null;
			owners.add(owner);
			resolved.add(key);
		}
		if (owners.size === 0) return null;
		const owner: ProductionBayBuildStepOwner | null = owners.has("BAY")
			? "BAY"
			: owners.size === 1
				? ([...owners][0] as ProductionBayBuildStepOwner)
				: null;
		if (!owner) return null;
		const edges = expected.get(owner);
		if (!edges) return null;
		for (const edge of module.eraseEdges) edges.add(staticFabOrganizationEdgeKey(edge));
	}
	if (resolved.size !== projection.edgeKeys.length) return null;
	if (!sameSet(expected.get("BAY"), directEdgeKeySet(bay))) return null;

	const processRecordsByEdgeSet = new Map<string, StaticFabOrganizationRecord[]>();
	for (const processLoop of processLoops) {
		const identity = setIdentity(directEdgeKeySet(processLoop));
		const records = processRecordsByEdgeSet.get(identity) ?? [];
		records.push(processLoop);
		processRecordsByEdgeSet.set(identity, records);
	}
	const mappedIds = new Map<ProcessLoopId, number>();
	for (const loopId of ["process-loop-a", "process-loop-b"] as const) {
		const identity = setIdentity(expected.get(loopId));
		const matches = processRecordsByEdgeSet.get(identity) ?? [];
		if (matches.length !== 1) return null;
		mappedIds.set(loopId, (matches[0] as StaticFabOrganizationRecord).id);
	}
	const processLoopA = mappedIds.get("process-loop-a");
	const processLoopB = mappedIds.get("process-loop-b");
	if (processLoopA === undefined || processLoopB === undefined || processLoopA === processLoopB) {
		return null;
	}
	return Object.freeze({
		"process-loop-a": processLoopA,
		"process-loop-b": processLoopB,
	});
}

type AliasVerification =
	| Readonly<{
			readonly valid: true;
			readonly minimum: number;
			readonly maximum: number;
			readonly count: number;
	  }>
	| Readonly<{ readonly valid: false; readonly result: ProductionBayModuleRecognitionResult }>;

function verifyGatewayLengthAliases(
	candidate: MatchedCandidate,
	authoredDirectedEdgeKeys: readonly string[],
): AliasVerification {
	// This bounded verification is valid only for the exact planner proof boundary above. Keeping
	// the literal typed against the exported policy makes a planner policy bump fail compilation
	// until recognition is deliberately reviewed.
	void SUPPORTED_GATEWAY_LENGTH_PROJECTION_POLICY;
	const minimum = PRODUCTION_BAY_MODULE_MINIMUM_GATEWAY_LENGTH_METERS;
	const maximum = Math.floor((candidate.plan.dimensions.processLoopLengthMeters - 1) / 2);
	if (maximum < minimum) {
		return aliasFailure("The recognized Production Bay has no valid gateway-length specification.");
	}
	let baseline: readonly Projection[] | null = null;
	const boundaryLengths = minimum === maximum ? [minimum] : [minimum, maximum];
	for (const gatewayLengthMeters of boundaryLengths) {
		const projections: Projection[] = [];
		for (const pattern of ["alternating", "co-rotating"] as const) {
			const plan = tryPlan(
				candidate.requestGeometry,
				candidate.plan.specification.pose.flow,
				pattern,
				gatewayLengthMeters,
			);
			const projection = plan ? authoredProjection(plan) : null;
			if (!projection) {
				return aliasFailure(
					`Gateway length ${gatewayLengthMeters} does not produce a complete authored projection.`,
				);
			}
			projections.push(projection);
		}
		const sourceProjection =
			projections[candidate.plan.specification.internalFlowPattern === "alternating" ? 0 : 1];
		if (!sameStrings(sourceProjection?.edgeKeys ?? [], authoredDirectedEdgeKeys)) {
			return aliasFailure(
				`Gateway length ${gatewayLengthMeters} changes the recognized source edge projection.`,
			);
		}
		if (!baseline) {
			baseline = Object.freeze(projections);
			continue;
		}
		for (let index = 0; index < projections.length; index++) {
			const current = projections[index] as Projection;
			const reference = baseline[index] as Projection;
			if (
				!sameStrings(current.edgeKeys, reference.edgeKeys) ||
				!sameStrings(current.semanticOwnerKeys, reference.semanticOwnerKeys)
			) {
				return aliasFailure(
					`Gateway length ${gatewayLengthMeters} changes a source or target semantic authored projection.`,
				);
			}
		}
	}
	return Object.freeze({ valid: true as const, minimum, maximum, count: maximum - minimum + 1 });
}

function aliasFailure(reason: string): AliasVerification {
	return Object.freeze({
		valid: false as const,
		result: invalidRecognition("NON_EQUIVALENT_SPECIFICATION_ALIASES", reason),
	});
}

function edgeBounds(edges: readonly DirectedRailEdge[]): AxisAlignedBounds | null {
	const first = edges[0];
	if (!first) return null;
	let minX = Math.min(first.from.x, first.to.x);
	let minY = Math.min(first.from.y, first.to.y);
	let maxX = Math.max(first.from.x, first.to.x);
	let maxY = Math.max(first.from.y, first.to.y);
	for (const edge of edges.slice(1)) {
		minX = Math.min(minX, edge.from.x, edge.to.x);
		minY = Math.min(minY, edge.from.y, edge.to.y);
		maxX = Math.max(maxX, edge.from.x, edge.to.x);
		maxY = Math.max(maxY, edge.from.y, edge.to.y);
	}
	return Object.freeze({ minX, minY, maxX, maxY });
}

function directEdgeKeySet(record: StaticFabOrganizationRecord): ReadonlySet<string> {
	return new Set(record.membership.railEdges.map(staticFabOrganizationEdgeKey));
}

function sortedUniqueEdgeKeys(edges: readonly DirectedRailEdge[]): readonly string[] {
	return Object.freeze([...new Set(edges.map(staticFabOrganizationEdgeKey))].sort());
}

function sameSet(left: ReadonlySet<string> | undefined, right: ReadonlySet<string>): boolean {
	if (!left || left.size !== right.size) return false;
	for (const value of left) if (!right.has(value)) return false;
	return true;
}

function setIdentity(values: ReadonlySet<string> | undefined): string {
	return values ? [...values].sort().join("|") : "";
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
	if (left.length !== right.length) return false;
	return left.every((value, index) => value === right[index]);
}

function projectionFingerprint(edgeKeys: readonly string[]): string {
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings(["PRODUCTION_BAY_MODULE_AUTHORED_PROJECTION_V1"]);
	checksum.addStrings(edgeKeys);
	return checksum.digest();
}

function invalidRecognition(
	issueCode: ProductionBayModuleRecognitionIssueCode,
	reason: string,
): ProductionBayModuleRecognitionResult {
	return Object.freeze({ valid: false as const, issueCode, reason });
}
