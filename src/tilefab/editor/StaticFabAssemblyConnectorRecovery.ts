import type { RailModuleSide } from "../core/RailModulePlanner";
import type { StaticFabAssemblyGatewayCandidate } from "../core/StaticFabAssemblyConnector";
import type { StaticFabAssemblyConnectorRecoveryTarget } from "./StaticFabAssemblyConnectorPanelHelpers";
import {
	cycleStaticFabAssemblyConnectorGateway,
	type StaticFabAssemblyConnectorSession,
	staticFabAssemblyConnectorSelectedSource,
	staticFabAssemblyConnectorSelectedTarget,
	staticFabAssemblyConnectorSourceCandidates,
	staticFabAssemblyConnectorTargetCandidates,
} from "./StaticFabAssemblyConnectorSession";

export const STATIC_FAB_ASSEMBLY_CONNECTOR_RECOVERY_ATTEMPT_LIMIT = 32;

/** Transient review-only cursor. It is never serialized or treated as route authority. */
export interface StaticFabAssemblyConnectorRecoveryCursor {
	readonly attempted: Set<string>;
	readonly automaticRecommendationAttempts: number;
}

export function createStaticFabAssemblyConnectorRecoveryCursor(
	automaticRecommendationAttempts = 0,
): StaticFabAssemblyConnectorRecoveryCursor {
	return {
		attempted: new Set<string>(),
		automaticRecommendationAttempts:
			Number.isSafeInteger(automaticRecommendationAttempts) && automaticRecommendationAttempts > 0
				? automaticRecommendationAttempts
				: 0,
	};
}

export function recordStaticFabAssemblyConnectorRecoveryAttempt(
	cursor: StaticFabAssemblyConnectorRecoveryCursor,
	session: StaticFabAssemblyConnectorSession,
): void {
	if (cursor.attempted.size >= STATIC_FAB_ASSEMBLY_CONNECTOR_RECOVERY_ATTEMPT_LIMIT) return;
	const signature = recoveryAttemptSignature(session);
	if (signature) cursor.attempted.add(signature);
}

export function nextStaticFabAssemblyConnectorRecoveryTarget(
	cursor: StaticFabAssemblyConnectorRecoveryCursor,
	session: StaticFabAssemblyConnectorSession,
): StaticFabAssemblyConnectorRecoveryTarget {
	if (cursor.attempted.size >= STATIC_FAB_ASSEMBLY_CONNECTOR_RECOVERY_ATTEMPT_LIMIT) {
		return "cancel";
	}
	const source = staticFabAssemblyConnectorSelectedSource(session);
	if (!source) return "cancel";
	const target = staticFabAssemblyConnectorSelectedTarget(session);
	const targetCandidates = staticFabAssemblyConnectorTargetCandidates(session);
	if (!target) return targetCandidates.length > 0 ? "target-next" : "cancel";
	if (!cursor.attempted.has(recoverySignature(source.id, target.id, "left"))) {
		return "side-left";
	}
	if (!cursor.attempted.has(recoverySignature(source.id, target.id, "right"))) {
		return "side-right";
	}
	const nextTarget = cycleStaticFabAssemblyConnectorGateway(targetCandidates, target.id, 1);
	if (
		nextTarget &&
		nextTarget.id !== target.id &&
		pairHasUntestedSide(cursor, source, nextTarget)
	) {
		return "target-next";
	}
	const sourceCandidates = staticFabAssemblyConnectorSourceCandidates(session);
	const nextSource = cycleStaticFabAssemblyConnectorGateway(sourceCandidates, source.id, 1);
	if (
		nextSource &&
		nextSource.id !== source.id &&
		targetCandidates.some((candidate) => pairHasUntestedSide(cursor, nextSource, candidate))
	) {
		return "source-next";
	}
	return "cancel";
}

function pairHasUntestedSide(
	cursor: StaticFabAssemblyConnectorRecoveryCursor,
	source: StaticFabAssemblyGatewayCandidate,
	target: StaticFabAssemblyGatewayCandidate,
): boolean {
	return (
		!cursor.attempted.has(recoverySignature(source.id, target.id, "left")) ||
		!cursor.attempted.has(recoverySignature(source.id, target.id, "right"))
	);
}

function recoveryAttemptSignature(session: StaticFabAssemblyConnectorSession): string | null {
	const source = staticFabAssemblyConnectorSelectedSource(session);
	const target = staticFabAssemblyConnectorSelectedTarget(session);
	return source && target ? recoverySignature(source.id, target.id, session.side) : null;
}

function recoverySignature(
	sourceGatewayId: string,
	targetGatewayId: string,
	side: RailModuleSide | null,
): string {
	return JSON.stringify([sourceGatewayId, targetGatewayId, side]);
}
