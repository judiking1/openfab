import { describe, expect, it } from "vitest";
import { DIR_E, DIR_W } from "../core/railShape";
import type { StaticFabAssemblyGatewayCandidate } from "../core/StaticFabAssemblyConnector";
import {
	createStaticFabAssemblyConnectorSession,
	cycleStaticFabAssemblyConnectorGateway,
	hitTestStaticFabAssemblyGateway,
	reduceStaticFabAssemblyConnectorSession,
	staticFabAssemblyConnectorIntent,
	staticFabAssemblyConnectorOverlayGateways,
	staticFabAssemblyConnectorRecommendationPairs,
	staticFabAssemblyConnectorSessionIsCurrent,
	staticFabAssemblyConnectorSourceCandidates,
	staticFabAssemblyConnectorTargetCandidates,
} from "./StaticFabAssemblyConnectorSession";

const sourceA = gateway("a-1", 11, -8, 0, 20, 0, DIR_E);
const sourceB = gateway("a-2", 11, -4, 0, 20, 0, DIR_E);
const target = gateway("b-1", 22, 8, 0, 20, 0, DIR_W);
const binding = Object.freeze({
	modelGeneration: 3,
	revision: 7,
	patchSequence: 9,
	nextAdvancedSwitchId: 1,
	nextPortId: 1,
	nextEquipmentGroupId: 1,
	nextOrganizationId: 23,
	hierarchyRole: "BAY_TO_BANK",
	purpose: "HIERARCHY_LINK",
	organizationIds: Object.freeze([11, 22] as const),
	gateways: Object.freeze([sourceA, sourceB, target]),
});

describe("StaticFabAssemblyConnectorSession", () => {
	it("requires source then target and ignores stale verification responses", () => {
		let state = createStaticFabAssemblyConnectorSession(binding);
		expect(staticFabAssemblyConnectorSourceCandidates(state)).toEqual([sourceA, sourceB]);
		expect(staticFabAssemblyConnectorTargetCandidates(state)).toEqual([target]);
		expect(staticFabAssemblyConnectorOverlayGateways(state)).toEqual([sourceA, sourceB]);
		expect(
			reduceStaticFabAssemblyConnectorSession(state, {
				type: "SELECT_SOURCE",
				gatewayId: target.id,
			}),
		).toBe(state);
		state = reduceStaticFabAssemblyConnectorSession(state, {
			type: "SELECT_SOURCE",
			gatewayId: sourceA.id,
		});
		expect(state.phase).toBe("pick-target-gateway");
		expect(staticFabAssemblyConnectorTargetCandidates(state)).toEqual([target]);
		expect(staticFabAssemblyConnectorOverlayGateways(state)).toEqual([sourceA, target]);
		expect(
			reduceStaticFabAssemblyConnectorSession(state, {
				type: "SELECT_TARGET",
				gatewayId: sourceB.id,
			}),
		).toBe(state);

		state = reduceStaticFabAssemblyConnectorSession(state, {
			type: "SELECT_TARGET",
			gatewayId: target.id,
		});
		expect(state.phase).toBe("verifying");
		const requestSequence = state.requestSequence;
		expect(staticFabAssemblyConnectorIntent(state)).toMatchObject({
			purpose: "HIERARCHY_LINK",
			sourceOrganizationId: 11,
			targetOrganizationId: 22,
			side: null,
		});

		const unchanged = reduceStaticFabAssemblyConnectorSession(state, {
			type: "VERIFICATION_READY",
			requestSequence: requestSequence - 1,
			reason: "stale",
			conflictCount: 0,
			timings: {
				workerRoundTripMilliseconds: 1,
				responseValidationMilliseconds: 1,
				adoptionMilliseconds: 1,
			},
		});
		expect(unchanged).toBe(state);

		state = reduceStaticFabAssemblyConnectorSession(state, {
			type: "VERIFICATION_READY",
			requestSequence,
			reason: "certified",
			conflictCount: 0,
			timings: {
				workerRoundTripMilliseconds: 3,
				responseValidationMilliseconds: 0.2,
				adoptionMilliseconds: 0.1,
			},
		});
		expect(state.phase).toBe("ready");
		expect(reduceStaticFabAssemblyConnectorSession(state, { type: "APPLY" }).phase).toBe(
			"applying",
		);
	});

	it("invalidates a certified result whenever the corridor side changes", () => {
		let state = createStaticFabAssemblyConnectorSession(binding);
		state = reduceStaticFabAssemblyConnectorSession(state, {
			type: "SELECT_SOURCE",
			gatewayId: sourceA.id,
		});
		state = reduceStaticFabAssemblyConnectorSession(state, {
			type: "SELECT_TARGET",
			gatewayId: target.id,
		});
		const previousSequence = state.requestSequence;
		state = reduceStaticFabAssemblyConnectorSession(state, { type: "SET_SIDE", side: "left" });
		expect(state).toMatchObject({ phase: "verifying", side: "left" });
		expect(state.requestSequence).toBe(previousSequence + 1);
		expect(reduceStaticFabAssemblyConnectorSession(state, { type: "SET_SIDE", side: "left" })).toBe(
			state,
		);
	});

	it("binds to every authored generation and keeps a 24 px full-band hit target", () => {
		const state = createStaticFabAssemblyConnectorSession(binding);
		expect(staticFabAssemblyConnectorSessionIsCurrent(state, binding)).toBe(true);
		expect(
			staticFabAssemblyConnectorSessionIsCurrent(state, { ...binding, nextOrganizationId: 24 }),
		).toBe(false);
		expect(hitTestStaticFabAssemblyGateway(binding.gateways, { x: 2, y: -6.4 }, 10)?.id).toBe(
			sourceA.id,
		);
		expect(hitTestStaticFabAssemblyGateway(binding.gateways, { x: 2, y: -5 }, 10)).toBeNull();
	});

	it("cycles deterministically in both directions", () => {
		expect(cycleStaticFabAssemblyConnectorGateway([sourceA, sourceB], null, 1)).toBe(sourceA);
		expect(cycleStaticFabAssemblyConnectorGateway([sourceA, sourceB], sourceA.id, -1)).toBe(
			sourceB,
		);
	});

	it("preserves the Fab Loop purpose in the exact Worker intent", () => {
		let state = createStaticFabAssemblyConnectorSession({ ...binding, purpose: "FAB_LOOP" });
		state = reduceStaticFabAssemblyConnectorSession(state, {
			type: "SELECT_SOURCE",
			gatewayId: sourceA.id,
		});
		state = reduceStaticFabAssemblyConnectorSession(state, {
			type: "SELECT_TARGET",
			gatewayId: target.id,
		});
		expect(staticFabAssemblyConnectorIntent(state)?.purpose).toBe("FAB_LOOP");
	});

	it("ranks a bounded review set without claiming that any pair is Worker-valid", () => {
		const sourceEast = gateway("source-east", 11, -88, 0, 40, -9, DIR_E);
		const sourceWest = gateway("source-west", 11, -66, 0, 40, -9, DIR_W);
		const sourceShort = gateway("source-short", 11, -44, 0, 12, -9, DIR_E);
		const targetEast = gateway("target-east", 22, -85, 0, 40, 92, DIR_E);
		const targetWest = gateway("target-west", 22, -63, 0, 40, 92, DIR_W);
		const targetShort = gateway("target-short", 22, -41, 0, 12, 92, DIR_E);
		const state = createStaticFabAssemblyConnectorSession({
			...binding,
			gateways: Object.freeze([
				sourceWest,
				targetWest,
				sourceShort,
				targetShort,
				sourceEast,
				targetEast,
			]),
		});

		expect(staticFabAssemblyConnectorRecommendationPairs(state, 2)).toEqual([
			{ sourceGatewayId: sourceEast.id, targetGatewayId: targetEast.id },
			{ sourceGatewayId: sourceWest.id, targetGatewayId: targetWest.id },
		]);
		expect(() => staticFabAssemblyConnectorRecommendationPairs(state, 9)).toThrow(RangeError);
		expect(staticFabAssemblyConnectorRecommendationPairs(state)).toHaveLength(8);
		expect(state).toMatchObject({
			phase: "pick-source-gateway",
			sourceGatewayId: null,
			targetGatewayId: null,
		});
	});
});

function gateway(
	id: string,
	organizationId: number,
	y: number,
	minimum: number,
	maximum: number,
	x: number,
	forward: typeof DIR_E | typeof DIR_W,
): StaticFabAssemblyGatewayCandidate {
	return Object.freeze({
		id,
		organizationId,
		anchor: Object.freeze({ x, y }),
		start: Object.freeze({ x: minimum, y }),
		end: Object.freeze({ x: maximum, y }),
		forward,
		axis: "x",
		runLengthMeters: maximum - minimum,
	});
}
