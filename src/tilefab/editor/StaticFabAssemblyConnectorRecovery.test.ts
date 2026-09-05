import { describe, expect, it } from "vitest";
import { DIR_E, DIR_W } from "../core/railShape";
import type { StaticFabAssemblyGatewayCandidate } from "../core/StaticFabAssemblyConnector";
import {
	createStaticFabAssemblyConnectorRecoveryCursor,
	nextStaticFabAssemblyConnectorRecoveryTarget,
	recordStaticFabAssemblyConnectorRecoveryAttempt,
	STATIC_FAB_ASSEMBLY_CONNECTOR_RECOVERY_ATTEMPT_LIMIT,
} from "./StaticFabAssemblyConnectorRecovery";
import {
	createStaticFabAssemblyConnectorSession,
	reduceStaticFabAssemblyConnectorSession,
	type StaticFabAssemblyConnectorSession,
} from "./StaticFabAssemblyConnectorSession";

const sourceA = gateway("source-a", 11, -8, DIR_E);
const sourceB = gateway("source-b", 11, -4, DIR_E);
const targetA = gateway("target-a", 22, 8, DIR_W);
const targetB = gateway("target-b", 22, 12, DIR_W);

describe("StaticFabAssemblyConnectorRecovery", () => {
	it("offers one deterministic untried action at a time and preserves automatic review count", () => {
		const cursor = createStaticFabAssemblyConnectorRecoveryCursor(8);
		let session = selectedSession(sourceA, targetA);
		expect(cursor.automaticRecommendationAttempts).toBe(8);
		expect(nextStaticFabAssemblyConnectorRecoveryTarget(cursor, session)).toBe("side-left");

		session = reduceStaticFabAssemblyConnectorSession(session, {
			type: "SET_SIDE",
			side: "left",
		});
		recordStaticFabAssemblyConnectorRecoveryAttempt(cursor, session);
		expect(nextStaticFabAssemblyConnectorRecoveryTarget(cursor, session)).toBe("side-right");

		session = reduceStaticFabAssemblyConnectorSession(session, {
			type: "SET_SIDE",
			side: "right",
		});
		recordStaticFabAssemblyConnectorRecoveryAttempt(cursor, session);
		expect(nextStaticFabAssemblyConnectorRecoveryTarget(cursor, session)).toBe("target-next");

		session = reduceStaticFabAssemblyConnectorSession(session, {
			type: "SELECT_TARGET",
			gatewayId: targetB.id,
		});
		recordStaticFabAssemblyConnectorRecoveryAttempt(cursor, session);
		expect(nextStaticFabAssemblyConnectorRecoveryTarget(cursor, session)).toBe("side-left");

		session = reduceStaticFabAssemblyConnectorSession(session, {
			type: "SET_SIDE",
			side: "left",
		});
		recordStaticFabAssemblyConnectorRecoveryAttempt(cursor, session);
		expect(nextStaticFabAssemblyConnectorRecoveryTarget(cursor, session)).toBe("source-next");
	});

	it("uses the next control to select a first target and stops at the bounded review limit", () => {
		const cursor = createStaticFabAssemblyConnectorRecoveryCursor(Number.NaN);
		let session = createSession();
		session = reduceStaticFabAssemblyConnectorSession(session, {
			type: "SELECT_SOURCE",
			gatewayId: sourceB.id,
		});
		expect(cursor.automaticRecommendationAttempts).toBe(0);
		expect(nextStaticFabAssemblyConnectorRecoveryTarget(cursor, session)).toBe("target-next");

		for (let index = 0; index < STATIC_FAB_ASSEMBLY_CONNECTOR_RECOVERY_ATTEMPT_LIMIT; index += 1) {
			cursor.attempted.add(`bounded-${index}`);
		}
		expect(nextStaticFabAssemblyConnectorRecoveryTarget(cursor, session)).toBe("cancel");
	});

	it("returns only opaque UI actions and never returns gateway IDs", () => {
		const cursor = createStaticFabAssemblyConnectorRecoveryCursor();
		const target = nextStaticFabAssemblyConnectorRecoveryTarget(
			cursor,
			selectedSession(sourceA, targetA),
		);
		expect(["side-left", "side-right", "target-next", "source-next", "cancel"]).toContain(target);
		expect(JSON.stringify(target)).not.toContain(sourceA.id);
		expect(JSON.stringify(target)).not.toContain(targetA.id);
	});
});

function createSession(): StaticFabAssemblyConnectorSession {
	return createStaticFabAssemblyConnectorSession({
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
		gateways: Object.freeze([sourceA, sourceB, targetA, targetB]),
	});
}

function selectedSession(
	source: StaticFabAssemblyGatewayCandidate,
	target: StaticFabAssemblyGatewayCandidate,
): StaticFabAssemblyConnectorSession {
	let session = createSession();
	session = reduceStaticFabAssemblyConnectorSession(session, {
		type: "SELECT_SOURCE",
		gatewayId: source.id,
	});
	return reduceStaticFabAssemblyConnectorSession(session, {
		type: "SELECT_TARGET",
		gatewayId: target.id,
	});
}

function gateway(
	id: string,
	organizationId: number,
	y: number,
	forward: typeof DIR_E | typeof DIR_W,
): StaticFabAssemblyGatewayCandidate {
	return Object.freeze({
		id,
		organizationId,
		anchor: Object.freeze({ x: 0, y }),
		start: Object.freeze({ x: -8, y }),
		end: Object.freeze({ x: 20, y }),
		forward,
		axis: "x",
		runLengthMeters: 28,
	});
}
