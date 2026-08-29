import type { RailModuleSide } from "../core/RailModulePlanner";
import {
	STATIC_FAB_ASSEMBLY_CONNECTOR_VERSION,
	type StaticFabAssemblyConnectorHierarchyRole,
	type StaticFabAssemblyConnectorIntent,
	type StaticFabAssemblyConnectorPurpose,
	type StaticFabAssemblyGatewayCandidate,
} from "../core/StaticFabAssemblyConnector";

export type StaticFabAssemblyConnectorSessionPhase =
	| "pick-source-gateway"
	| "pick-target-gateway"
	| "verifying"
	| "ready"
	| "rejected"
	| "applying";

export interface StaticFabAssemblyConnectorSessionBinding {
	readonly modelGeneration: number;
	readonly revision: number;
	readonly patchSequence: number;
	readonly nextAdvancedSwitchId: number;
	readonly nextPortId: number;
	readonly nextEquipmentGroupId: number;
	readonly nextOrganizationId: number;
	readonly hierarchyRole: StaticFabAssemblyConnectorHierarchyRole;
	readonly purpose: StaticFabAssemblyConnectorPurpose;
	readonly organizationIds: readonly [number, number];
	readonly gateways: readonly StaticFabAssemblyGatewayCandidate[];
	readonly gatewaysByOrganizationId: ReadonlyMap<
		number,
		readonly StaticFabAssemblyGatewayCandidate[]
	>;
	readonly gatewaysById: ReadonlyMap<string, StaticFabAssemblyGatewayCandidate>;
	readonly hitIntervals: ReadonlyMap<string, StaticFabAssemblyGatewayHitInterval>;
	readonly overlayGatewaysBySourceGatewayId: ReadonlyMap<
		string,
		readonly StaticFabAssemblyGatewayCandidate[]
	>;
}

export interface StaticFabAssemblyGatewayHitInterval {
	readonly gateway: StaticFabAssemblyGatewayCandidate;
	readonly startX: number;
	readonly startY: number;
	readonly endX: number;
	readonly endY: number;
}

export interface StaticFabAssemblyConnectorLiveIdentity {
	readonly modelGeneration: number;
	readonly revision: number;
	readonly patchSequence: number;
	readonly nextAdvancedSwitchId: number;
	readonly nextPortId: number;
	readonly nextEquipmentGroupId: number;
	readonly nextOrganizationId: number;
}

export interface StaticFabAssemblyConnectorSessionTimings {
	readonly workerRoundTripMilliseconds: number | null;
	readonly responseValidationMilliseconds: number | null;
	readonly adoptionMilliseconds: number | null;
}

export interface StaticFabAssemblyConnectorSession {
	readonly binding: StaticFabAssemblyConnectorSessionBinding;
	readonly phase: StaticFabAssemblyConnectorSessionPhase;
	readonly sourceGatewayId: string | null;
	readonly targetGatewayId: string | null;
	readonly side: RailModuleSide | null;
	readonly reason: string;
	readonly conflictCount: number;
	readonly timings: StaticFabAssemblyConnectorSessionTimings | null;
	readonly requestSequence: number;
}

export interface StaticFabAssemblyConnectorRecommendationPair {
	readonly sourceGatewayId: string;
	readonly targetGatewayId: string;
}

export const STATIC_FAB_ASSEMBLY_CONNECTOR_RECOMMENDATION_PAIR_LIMIT = 8;

export type StaticFabAssemblyConnectorSessionAction =
	| Readonly<{ type: "SELECT_SOURCE"; gatewayId: string }>
	| Readonly<{ type: "SELECT_TARGET"; gatewayId: string }>
	| Readonly<{ type: "SET_SIDE"; side: RailModuleSide | null }>
	| Readonly<{
			type: "VERIFICATION_READY";
			requestSequence: number;
			reason: string;
			conflictCount: number;
			timings: StaticFabAssemblyConnectorSessionTimings;
	  }>
	| Readonly<{
			type: "VERIFICATION_REJECTED";
			requestSequence: number;
			reason: string;
			conflictCount: number;
			timings: StaticFabAssemblyConnectorSessionTimings | null;
	  }>
	| Readonly<{ type: "APPLY" }>;

export function createStaticFabAssemblyConnectorSession(
	input: Omit<
		StaticFabAssemblyConnectorSessionBinding,
		| "gatewaysByOrganizationId"
		| "gatewaysById"
		| "hitIntervals"
		| "overlayGatewaysBySourceGatewayId"
	>,
): StaticFabAssemblyConnectorSession {
	if (input.organizationIds[0] === input.organizationIds[1]) {
		throw new Error("Assembly Connector requires two distinct hierarchy children.");
	}
	const gatewaysByOrganizationId = new Map<number, StaticFabAssemblyGatewayCandidate[]>();
	const gatewaysById = new Map<string, StaticFabAssemblyGatewayCandidate>();
	const hitIntervals = new Map<string, StaticFabAssemblyGatewayHitInterval>();
	for (const gateway of input.gateways) {
		gatewaysById.set(gateway.id, gateway);
		const organizationGateways = gatewaysByOrganizationId.get(gateway.organizationId);
		if (organizationGateways) organizationGateways.push(gateway);
		else gatewaysByOrganizationId.set(gateway.organizationId, [gateway]);
		const interval = gatewayWorldInterval(gateway);
		hitIntervals.set(
			gateway.id,
			Object.freeze({
				gateway,
				startX: interval.start.x,
				startY: interval.start.y,
				endX: interval.end.x,
				endY: interval.end.y,
			}),
		);
	}
	const binding: StaticFabAssemblyConnectorSessionBinding = Object.freeze({
		...input,
		gatewaysByOrganizationId: new Map(
			[...gatewaysByOrganizationId].map(([id, gateways]) => [id, Object.freeze(gateways)]),
		),
		gatewaysById,
		hitIntervals,
		overlayGatewaysBySourceGatewayId: new Map(
			input.gateways.map((source) => {
				const targetOrganizationId = input.organizationIds.find(
					(id) => id !== source.organizationId,
				);
				return [
					source.id,
					Object.freeze([
						source,
						...(targetOrganizationId === undefined
							? []
							: (gatewaysByOrganizationId.get(targetOrganizationId) ?? [])),
					]),
				] as const;
			}),
		),
	});
	return freezeSession({
		binding,
		phase: "pick-source-gateway",
		sourceGatewayId: null,
		targetGatewayId: null,
		side: null,
		reason:
			input.purpose === "FAB_LOOP"
				? "첫 번째 Bank의 강조된 외곽 Bay gateway를 선택하세요"
				: input.hierarchyRole === "BAY_TO_BANK"
					? "첫 번째 Bay의 강조된 외곽 gateway를 선택하세요"
					: "첫 번째 Bank의 강조된 Interbay gateway를 선택하세요",
		conflictCount: 0,
		timings: null,
		requestSequence: 0,
	});
}

export function reduceStaticFabAssemblyConnectorSession(
	state: StaticFabAssemblyConnectorSession,
	action: StaticFabAssemblyConnectorSessionAction,
): StaticFabAssemblyConnectorSession {
	switch (action.type) {
		case "SELECT_SOURCE": {
			const source = state.binding.gatewaysById.get(action.gatewayId) ?? null;
			if (!source || source.organizationId !== state.binding.organizationIds[0]) return state;
			return freezeSession({
				...state,
				phase: "pick-target-gateway",
				sourceGatewayId: source.id,
				targetGatewayId: null,
				reason:
					state.binding.hierarchyRole === "BAY_TO_BANK"
						? "다른 Bay의 강조된 gateway를 선택하세요"
						: "다른 Bank의 강조된 Interbay gateway를 선택하세요",
				conflictCount: 0,
				timings: null,
				requestSequence: state.requestSequence + 1,
			});
		}
		case "SELECT_TARGET": {
			const source = selectedSourceGateway(state);
			const target = state.binding.gatewaysById.get(action.gatewayId) ?? null;
			if (!source || !target || target.organizationId !== state.binding.organizationIds[1]) {
				return state;
			}
			return beginVerification(state, target.id, state.side);
		}
		case "SET_SIDE":
			if (action.side === state.side) return state;
			return state.sourceGatewayId && state.targetGatewayId
				? beginVerification(state, state.targetGatewayId, action.side)
				: freezeSession({ ...state, side: action.side });
		case "VERIFICATION_READY":
			if (state.phase !== "verifying" || action.requestSequence !== state.requestSequence) {
				return state;
			}
			return freezeSession({
				...state,
				phase: "ready",
				reason: action.reason,
				conflictCount: action.conflictCount,
				timings: action.timings,
			});
		case "VERIFICATION_REJECTED":
			if (state.phase !== "verifying" || action.requestSequence !== state.requestSequence) {
				return state;
			}
			return freezeSession({
				...state,
				phase: "rejected",
				reason: action.reason,
				conflictCount: action.conflictCount,
				timings: action.timings,
			});
		case "APPLY":
			return state.phase === "ready" ? freezeSession({ ...state, phase: "applying" }) : state;
	}
}

export function staticFabAssemblyConnectorSourceCandidates(
	state: StaticFabAssemblyConnectorSession,
): readonly StaticFabAssemblyGatewayCandidate[] {
	return (
		state.binding.gatewaysByOrganizationId.get(state.binding.organizationIds[0]) ??
		Object.freeze([])
	);
}

export function staticFabAssemblyConnectorTargetCandidates(
	state: StaticFabAssemblyConnectorSession,
): readonly StaticFabAssemblyGatewayCandidate[] {
	const source = selectedSourceGateway(state);
	const targetOrganizationId = source
		? state.binding.organizationIds.find((id) => id !== source.organizationId)
		: state.binding.organizationIds[1];
	return targetOrganizationId === undefined
		? Object.freeze([])
		: (state.binding.gatewaysByOrganizationId.get(targetOrganizationId) ?? Object.freeze([]));
}

/**
 * Rank a small deterministic set of UI-only gateway pairs for exact Worker review. This does not
 * claim that a pair is valid: route, clearance, hierarchy, and resilient-circulation authority
 * remain exclusively with the Connector Worker.
 */
export function staticFabAssemblyConnectorRecommendationPairs(
	state: StaticFabAssemblyConnectorSession,
	limit = STATIC_FAB_ASSEMBLY_CONNECTOR_RECOMMENDATION_PAIR_LIMIT,
): readonly StaticFabAssemblyConnectorRecommendationPair[] {
	if (
		!Number.isSafeInteger(limit) ||
		limit <= 0 ||
		limit > STATIC_FAB_ASSEMBLY_CONNECTOR_RECOMMENDATION_PAIR_LIMIT
	) {
		throw new RangeError(
			`Assembly Connector recommendation limit must be a 1-${STATIC_FAB_ASSEMBLY_CONNECTOR_RECOMMENDATION_PAIR_LIMIT} integer.`,
		);
	}
	const ranked = staticFabAssemblyConnectorSourceCandidates(state).flatMap((source) =>
		staticFabAssemblyConnectorTargetCandidates(state).map((target) => ({ source, target })),
	);
	ranked.sort((left, right) => {
		const leftCompatibility = recommendationCompatibilityRank(left.source, left.target);
		const rightCompatibility = recommendationCompatibilityRank(right.source, right.target);
		return (
			leftCompatibility - rightCompatibility ||
			Math.min(right.source.runLengthMeters, right.target.runLengthMeters) -
				Math.min(left.source.runLengthMeters, left.target.runLengthMeters) ||
			recommendationDistanceSquared(left.source, left.target) -
				recommendationDistanceSquared(right.source, right.target) ||
			compareText(left.source.id, right.source.id) ||
			compareText(left.target.id, right.target.id)
		);
	});
	return Object.freeze(
		ranked.slice(0, limit).map(({ source, target }) =>
			Object.freeze({
				sourceGatewayId: source.id,
				targetGatewayId: target.id,
			}),
		),
	);
}

/** Exactly the gateway bands that are actionable in the current canvas step. */
export function staticFabAssemblyConnectorOverlayGateways(
	state: StaticFabAssemblyConnectorSession,
): readonly StaticFabAssemblyGatewayCandidate[] {
	return state.sourceGatewayId
		? (state.binding.overlayGatewaysBySourceGatewayId.get(state.sourceGatewayId) ??
				Object.freeze([]))
		: staticFabAssemblyConnectorSourceCandidates(state);
}

export function staticFabAssemblyConnectorSelectedSource(
	state: StaticFabAssemblyConnectorSession,
): StaticFabAssemblyGatewayCandidate | null {
	return selectedSourceGateway(state);
}

export function staticFabAssemblyConnectorSelectedTarget(
	state: StaticFabAssemblyConnectorSession,
): StaticFabAssemblyGatewayCandidate | null {
	return state.targetGatewayId
		? (state.binding.gatewaysById.get(state.targetGatewayId) ?? null)
		: null;
}

export function staticFabAssemblyConnectorIntent(
	state: StaticFabAssemblyConnectorSession,
): StaticFabAssemblyConnectorIntent | null {
	const source = staticFabAssemblyConnectorSelectedSource(state);
	const target = staticFabAssemblyConnectorSelectedTarget(state);
	if (!source || !target || source.organizationId === target.organizationId) return null;
	return Object.freeze({
		version: STATIC_FAB_ASSEMBLY_CONNECTOR_VERSION,
		purpose: state.binding.purpose,
		sourceOrganizationId: source.organizationId,
		sourceGatewayId: source.id,
		sourceAnchor: source.anchor,
		targetOrganizationId: target.organizationId,
		targetGatewayId: target.id,
		targetAnchor: target.anchor,
		side: state.side,
	});
}

export function staticFabAssemblyConnectorSessionIsCurrent(
	state: StaticFabAssemblyConnectorSession,
	live: StaticFabAssemblyConnectorLiveIdentity,
): boolean {
	const binding = state.binding;
	return (
		binding.modelGeneration === live.modelGeneration &&
		binding.revision === live.revision &&
		binding.patchSequence === live.patchSequence &&
		binding.nextAdvancedSwitchId === live.nextAdvancedSwitchId &&
		binding.nextPortId === live.nextPortId &&
		binding.nextEquipmentGroupId === live.nextEquipmentGroupId &&
		binding.nextOrganizationId === live.nextOrganizationId
	);
}

export function cycleStaticFabAssemblyConnectorGateway(
	candidates: readonly StaticFabAssemblyGatewayCandidate[],
	selectedGatewayId: string | null,
	step: -1 | 1,
): StaticFabAssemblyGatewayCandidate | null {
	if (candidates.length === 0) return null;
	const current = candidates.findIndex((candidate) => candidate.id === selectedGatewayId);
	const next = current < 0 ? (step < 0 ? candidates.length - 1 : 0) : current + step;
	return candidates[(next + candidates.length) % candidates.length] ?? null;
}

/** Hit-tests the full gateway band with a stable 24 px minimum pointer target. */
export function hitTestStaticFabAssemblyGateway(
	gateways: readonly StaticFabAssemblyGatewayCandidate[],
	world: Readonly<{ x: number; y: number }>,
	zoomPixelsPerMeter: number,
	minimumTargetPixels = 24,
): StaticFabAssemblyGatewayCandidate | null {
	const radiusMeters = Math.max(0.6, (minimumTargetPixels * 0.5) / Math.max(1, zoomPixelsPerMeter));
	let best: StaticFabAssemblyGatewayCandidate | null = null;
	let bestDistance = Number.POSITIVE_INFINITY;
	for (const gateway of gateways) {
		const interval = gatewayWorldInterval(gateway);
		const distance = distanceToSegment(world, interval.start, interval.end);
		if (
			distance <= radiusMeters &&
			(distance < bestDistance || (distance === bestDistance && gateway.id < (best?.id ?? "")))
		) {
			best = gateway;
			bestDistance = distance;
		}
	}
	return best;
}

/** Allocation-free pointer path over immutable session intervals. */
export function hitTestStaticFabAssemblyGatewayIntervals(
	intervals: ReadonlyMap<string, StaticFabAssemblyGatewayHitInterval>,
	gateways: readonly StaticFabAssemblyGatewayCandidate[],
	world: Readonly<{ x: number; y: number }>,
	zoomPixelsPerMeter: number,
	minimumTargetPixels = 24,
): StaticFabAssemblyGatewayCandidate | null {
	const radiusMeters = Math.max(0.6, (minimumTargetPixels * 0.5) / Math.max(1, zoomPixelsPerMeter));
	let best: StaticFabAssemblyGatewayCandidate | null = null;
	let bestDistance = Number.POSITIVE_INFINITY;
	for (const gateway of gateways) {
		const interval = intervals.get(gateway.id);
		if (!interval) continue;
		const distance = distanceToSegmentNumbers(
			world.x,
			world.y,
			interval.startX,
			interval.startY,
			interval.endX,
			interval.endY,
		);
		if (
			distance <= radiusMeters &&
			(distance < bestDistance || (distance === bestDistance && gateway.id < (best?.id ?? "")))
		) {
			best = gateway;
			bestDistance = distance;
		}
	}
	return best;
}

function beginVerification(
	state: StaticFabAssemblyConnectorSession,
	targetGatewayId: string,
	side: RailModuleSide | null,
): StaticFabAssemblyConnectorSession {
	return freezeSession({
		...state,
		phase: "verifying",
		targetGatewayId,
		side,
		reason: "정확한 outbound·return 경로와 Bay Bank 귀속을 Worker에서 검증합니다",
		conflictCount: 0,
		timings: null,
		requestSequence: state.requestSequence + 1,
	});
}

function recommendationCompatibilityRank(
	source: StaticFabAssemblyGatewayCandidate,
	target: StaticFabAssemblyGatewayCandidate,
): number {
	if (source.forward === target.forward) return 0;
	return source.axis === target.axis ? 1 : 2;
}

function recommendationDistanceSquared(
	source: StaticFabAssemblyGatewayCandidate,
	target: StaticFabAssemblyGatewayCandidate,
): number {
	const dx = source.anchor.x - target.anchor.x;
	const dy = source.anchor.y - target.anchor.y;
	return dx * dx + dy * dy;
}

function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function selectedSourceGateway(
	state: StaticFabAssemblyConnectorSession,
): StaticFabAssemblyGatewayCandidate | null {
	return state.sourceGatewayId
		? (state.binding.gatewaysById.get(state.sourceGatewayId) ?? null)
		: null;
}

function distanceToSegmentNumbers(
	pointX: number,
	pointY: number,
	startX: number,
	startY: number,
	endX: number,
	endY: number,
): number {
	const dx = endX - startX;
	const dy = endY - startY;
	const lengthSquared = dx * dx + dy * dy;
	if (lengthSquared === 0) return Math.hypot(pointX - startX, pointY - startY);
	const t = Math.max(
		0,
		Math.min(1, ((pointX - startX) * dx + (pointY - startY) * dy) / lengthSquared),
	);
	return Math.hypot(pointX - (startX + dx * t), pointY - (startY + dy * t));
}

function gatewayWorldInterval(gateway: StaticFabAssemblyGatewayCandidate): Readonly<{
	start: Readonly<{ x: number; y: number }>;
	end: Readonly<{ x: number; y: number }>;
}> {
	const offsetX = gateway.axis === "x" ? 0 : 0.5;
	const offsetY = gateway.axis === "y" ? 0 : 0.5;
	return Object.freeze({
		start: Object.freeze({ x: gateway.start.x + offsetX, y: gateway.start.y + offsetY }),
		end: Object.freeze({ x: gateway.end.x + offsetX, y: gateway.end.y + offsetY }),
	});
}

function distanceToSegment(
	point: Readonly<{ x: number; y: number }>,
	start: Readonly<{ x: number; y: number }>,
	end: Readonly<{ x: number; y: number }>,
): number {
	const dx = end.x - start.x;
	const dy = end.y - start.y;
	const lengthSquared = dx * dx + dy * dy;
	if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.y - start.y);
	const t = Math.max(
		0,
		Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared),
	);
	return Math.hypot(point.x - (start.x + dx * t), point.y - (start.y + dy * t));
}

function freezeSession(
	state: StaticFabAssemblyConnectorSession,
): StaticFabAssemblyConnectorSession {
	return Object.freeze(state);
}
