import { describe, expect, it, vi } from "vitest";
import type { SourceBoundCooperativeTask } from "./SourceBoundCooperativeTask";
import * as connector from "./StaticFabAssemblyConnector";
import {
	createStaticFabAssemblyConnectorLaunchPreparation,
	type StaticFabAssemblyConnectorLaunchInput,
	type StaticFabAssemblyConnectorLaunchResult,
} from "./StaticFabAssemblyConnectorLaunch";
import {
	type LaunchFixture,
	placeProductionBays,
	sameFabBankFixture,
} from "./StaticFabAssemblyConnectorLaunch.test-fixtures";
import {
	createStaticFabCheckRepairTargetIndexPreparation,
	type StaticFabCheckRepairTargetIndex,
} from "./StaticFabCheckRepairTargetIndex";
import type { StaticFabOrganizationState } from "./StaticFabOrganization";
import {
	createStaticFabOrganizationMetadataLookupPreparation,
	type StaticFabOrganizationMetadataLookup,
} from "./StaticFabOrganizationMetadataLookup";

function expectCode(run: () => unknown, code: string): void {
	let error: unknown;
	try {
		run();
	} catch (caught) {
		error = caught;
	}
	expect(error).toMatchObject({ code });
}

function advance<T>(task: SourceBoundCooperativeTask<T>, budget = 128): void {
	let turns = 0;
	while (!task.done) {
		const operations = task.step(budget);
		expect(operations).toBeGreaterThan(0);
		expect(operations).toBeLessThanOrEqual(128);
		if (++turns > 2_000_000) throw new Error("cooperative fixture did not finish");
	}
}

function metadata(organizations: StaticFabOrganizationState): StaticFabOrganizationMetadataLookup {
	const preparation = createStaticFabOrganizationMetadataLookupPreparation(
		organizations,
		() => true,
	);
	advance(preparation);
	return preparation.finish();
}

function indexOwned(fixture: LaunchFixture): {
	index: StaticFabCheckRepairTargetIndex;
	metadataLookup: StaticFabOrganizationMetadataLookup;
} {
	const metadataLookup = metadata(fixture.organizations);
	const preparation = createStaticFabCheckRepairTargetIndexPreparation(
		fixture.organizations,
		metadataLookup,
	);
	advance(preparation);
	return { index: preparation.finish(), metadataLookup };
}

function pair(fixture: LaunchFixture): readonly [number, number] {
	const ids = fixture.organizations.records
		.filter((record) => record.kind === "BAY")
		.map((record) => record.id);
	if (ids.length !== 2 || ids[0] === undefined || ids[1] === undefined)
		throw new Error("expected two Bays");
	return [ids[0], ids[1]];
}

function launchInput(
	fixture: LaunchFixture,
	index: StaticFabCheckRepairTargetIndex,
	ids: readonly [number, number],
): StaticFabAssemblyConnectorLaunchInput {
	return {
		map: fixture.map,
		organizations: fixture.organizations,
		metadataLookup: index.metadataLookup,
		organizationIds: ids,
		capturedMapRevision: fixture.map.getRevision(),
		isSourceCurrent: () => true,
	};
}

interface ChildObservation {
	started: number;
	yields: number;
	closed: number;
}

function spyForwardingChild<T>(
	original: (
		...args: Parameters<typeof connector.discoverStaticFabAssemblyGatewaysSteps>
	) => Generator<void, T>,
	observation: ChildObservation,
	onYield: () => void,
): ReturnType<typeof vi.spyOn> {
	return vi
		.spyOn(
			connector,
			original === connector.discoverStaticFabAssemblyGatewaysSteps
				? "discoverStaticFabAssemblyGatewaysSteps"
				: "discoverStaticFabOuterCirculationGatewaysSteps",
		)
		.mockImplementation(((
			...args: Parameters<typeof connector.discoverStaticFabAssemblyGatewaysSteps>
		) => {
			const child = original(...args);
			return (function* forward(): Generator<void, T> {
				observation.started++;
				let completed = false;
				try {
					while (true) {
						const next = child.next();
						if (next.done) {
							completed = true;
							return next.value;
						}
						observation.yields++;
						onYield();
						yield;
					}
				} finally {
					if (!completed) child.return(undefined as never);
					observation.closed++;
				}
			})();
		}) as never);
}

describe("Connector launch child traversal cancellation", () => {
	it("cancels during the third real direct gateway-generator yield and preserves the index owner", () => {
		const fixture = placeProductionBays([
			{ x: 0, y: 0 },
			{ x: 100, y: 0 },
		]);
		const ids = pair(fixture);
		const owned = indexOwned(fixture);
		let task!: SourceBoundCooperativeTask<StaticFabAssemblyConnectorLaunchResult>;
		const observation: ChildObservation = { started: 0, yields: 0, closed: 0 };
		let cancelled = false;
		const original = connector.discoverStaticFabAssemblyGatewaysSteps;
		const spy = spyForwardingChild(original, observation, () => {
			if (observation.yields === 3 && !cancelled) {
				cancelled = true;
				task.cancel();
			}
		});
		try {
			const input = launchInput(fixture, owned.index, ids as [number, number]);
			task = createStaticFabAssemblyConnectorLaunchPreparation(input);
			expectCode(() => task.step(128), "CANCELLED");
			expect(observation.started).toBeGreaterThanOrEqual(1);
			expect(observation.yields).toBeGreaterThanOrEqual(3);
			expect(observation.closed).toBe(observation.started);
			expectCode(() => task.finish(), "CANCELLED");

			const query = owned.index.query();
			advance(query);
			expect(query.finish().matches.length).toBeGreaterThan(0);
			const replacement = createStaticFabAssemblyConnectorLaunchPreparation(input);
			advance(replacement);
			expect(replacement.finish().gateways.length).toBeGreaterThan(0);
		} finally {
			spy.mockRestore();
			owned.index.dispose();
		}
	});

	it("cancels during the third real outer-circulation child yield and preserves replacement use", () => {
		const fixture = sameFabBankFixture();
		const ids: readonly [number, number] = [1, 10];
		const owned = indexOwned(fixture);
		let task!: SourceBoundCooperativeTask<StaticFabAssemblyConnectorLaunchResult>;
		const observation: ChildObservation = { started: 0, yields: 0, closed: 0 };
		let cancelled = false;
		const original = connector.discoverStaticFabOuterCirculationGatewaysSteps;
		const spy = spyForwardingChild(original, observation, () => {
			if (observation.yields === 3 && !cancelled) {
				cancelled = true;
				task.cancel();
			}
		});
		try {
			const input = launchInput(fixture, owned.index, ids);
			task = createStaticFabAssemblyConnectorLaunchPreparation(input);
			expectCode(() => task.step(128), "CANCELLED");
			expect(observation.started).toBeGreaterThanOrEqual(1);
			expect(observation.yields).toBeGreaterThanOrEqual(3);
			expect(observation.closed).toBe(observation.started);
			expectCode(() => task.finish(), "CANCELLED");

			const query = owned.index.query();
			advance(query);
			expect(query.finish().matches.length).toBeGreaterThan(0);
			const replacement = createStaticFabAssemblyConnectorLaunchPreparation(input);
			advance(replacement);
			const result = replacement.finish();
			expect(result.purpose).toBe("FAB_LOOP");
			expect(result.gateways.length).toBeGreaterThan(0);
		} finally {
			spy.mockRestore();
			owned.index.dispose();
		}
	});
});
