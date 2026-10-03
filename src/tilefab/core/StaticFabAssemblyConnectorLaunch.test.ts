import { describe, expect, it } from "vitest";
import type { SourceBoundCooperativeTask } from "./SourceBoundCooperativeTask";
import {
	discoverStaticFabAssemblyGateways,
	discoverStaticFabOuterCirculationGateways,
	STATIC_FAB_ASSEMBLY_GATEWAY_LIMIT,
	STATIC_FAB_ASSEMBLY_GATEWAY_MINIMUM_RUN_METERS,
	type StaticFabAssemblyConnectorSelectionBounds,
	staticFabAssemblyConnectorHierarchyEligibility,
	staticFabAssemblyConnectorSelectionBounds,
	staticFabAssemblyInterbayConnectorHierarchyEligibility,
} from "./StaticFabAssemblyConnector";
import {
	assertStaticFabAssemblyConnectorLaunchResultCurrent,
	captureStaticFabAssemblyConnectorLaunchInput,
	createStaticFabAssemblyConnectorLaunchPreparation,
	type StaticFabAssemblyConnectorLaunchInput,
	type StaticFabAssemblyConnectorLaunchResult,
} from "./StaticFabAssemblyConnectorLaunch";
import {
	cappedGatewayFixture,
	type LaunchFixture,
	largeLaunchFixture,
	placeProductionBays,
	sameFabBankFixture,
} from "./StaticFabAssemblyConnectorLaunch.test-fixtures";
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

function metadata(
	organizations: StaticFabOrganizationState,
	isCurrent: (source: StaticFabOrganizationState) => boolean = (source) => source === organizations,
): StaticFabOrganizationMetadataLookup {
	const preparation = createStaticFabOrganizationMetadataLookupPreparation(
		organizations,
		isCurrent,
	);
	advance(preparation);
	return preparation.finish();
}

function input(
	fixture: LaunchFixture,
	metadataLookup: StaticFabOrganizationMetadataLookup,
	organizationIds: readonly [number, number],
	isSourceCurrent: (request: StaticFabAssemblyConnectorLaunchInput) => boolean = () => true,
): StaticFabAssemblyConnectorLaunchInput {
	return {
		map: fixture.map,
		organizations: fixture.organizations,
		metadataLookup,
		organizationIds,
		capturedMapRevision: fixture.map.getRevision(),
		isSourceCurrent,
	};
}

function prepare(
	fixture: LaunchFixture,
	ids: readonly [number, number],
	isCurrent: (request: StaticFabAssemblyConnectorLaunchInput) => boolean = () => true,
): {
	task: SourceBoundCooperativeTask<StaticFabAssemblyConnectorLaunchResult>;
	request: StaticFabAssemblyConnectorLaunchInput;
	metadataLookup: StaticFabOrganizationMetadataLookup;
} {
	const metadataLookup = metadata(fixture.organizations);
	const request = captureStaticFabAssemblyConnectorLaunchInput(
		input(fixture, metadataLookup, ids, isCurrent),
	);
	return {
		task: createStaticFabAssemblyConnectorLaunchPreparation(request),
		request,
		metadataLookup,
	};
}

function bayIds(fixture: LaunchFixture): readonly [number, number] {
	const ids = fixture.organizations.records
		.filter((record) => record.kind === "BAY")
		.map((record) => record.id);
	if (ids.length !== 2 || ids[0] === undefined || ids[1] === undefined)
		throw new Error("expected two synthetic bays");
	return [ids[0], ids[1]];
}

function expectBoundsEqual(
	actual: StaticFabAssemblyConnectorSelectionBounds | null,
	expected: StaticFabAssemblyConnectorSelectionBounds | null,
): void {
	expect(actual).toEqual(expected);
}

describe("cooperative Checks Assembly Connector launch preparation", () => {
	it("matches direct Bay discovery and selected bounds for both explicit pair orders", () => {
		const fixture = placeProductionBays([
			{ x: 0, y: 0 },
			{ x: 100, y: 0 },
		]);
		const ids = bayIds(fixture);
		for (const selected of [ids, [ids[1], ids[0]] as const]) {
			const prepared = prepare(fixture, selected);
			advance(prepared.task);
			const result = prepared.task.finish();
			assertStaticFabAssemblyConnectorLaunchResultCurrent(result, prepared.request);
			const sorted = [...selected].sort((left, right) => left - right);
			const expectedGateways = sorted.flatMap((id) =>
				discoverStaticFabAssemblyGateways(fixture.map, fixture.organizations, id),
			);
			expect(result.organizationIds).toEqual(sorted);
			expect(result.hierarchyRole).toBe("BAY_TO_BANK");
			expect(result.purpose).toBe("HIERARCHY_LINK");
			expect(result.gateways).toEqual(expectedGateways);
			expectBoundsEqual(
				result.selectionBounds,
				staticFabAssemblyConnectorSelectionBounds(fixture.organizations, sorted),
			);
			expect(result.eligibility).toEqual(
				staticFabAssemblyConnectorHierarchyEligibility(
					fixture.organizations,
					sorted[0] as number,
					sorted[1] as number,
				),
			);
			prepared.metadataLookup.revoke();
		}
	});

	it("matches outer-circulation Bank/FAB_LOOP discovery in both pair orders", () => {
		const fixture = sameFabBankFixture();
		const ids: readonly [number, number] = [1, 10];
		for (const selected of [ids, [ids[1], ids[0]] as const]) {
			const prepared = prepare(fixture, selected);
			advance(prepared.task);
			const result = prepared.task.finish();
			const sorted = [...selected].sort((left, right) => left - right);
			expect(result.hierarchyRole).toBe("BANK_TO_FAB");
			expect(result.purpose).toBe("FAB_LOOP");
			expect(result.eligibility).toEqual(
				staticFabAssemblyInterbayConnectorHierarchyEligibility(
					fixture.organizations,
					sorted[0] as number,
					sorted[1] as number,
				),
			);
			const expectedGateways = sorted.flatMap((id) =>
				discoverStaticFabOuterCirculationGateways(fixture.map, fixture.organizations, id),
			);
			expect(result.gateways).toEqual(expectedGateways);
			expect(result.gateways.length).toBeGreaterThan(0);
			for (const id of sorted) {
				expect(
					result.gateways.filter((gateway) => gateway.organizationId === id).length,
				).toBeGreaterThanOrEqual(1);
			}
			expectBoundsEqual(
				result.selectionBounds,
				staticFabAssemblyConnectorSelectionBounds(fixture.organizations, sorted),
			);
			prepared.metadataLookup.revoke();
		}
	});

	it("preserves 12 m/map-anchor filtering and the 64-per-owner cap with exact cooperative parity", () => {
		const fixture = cappedGatewayFixture();
		const ids: readonly [number, number] = [1, 2];
		const prepared = prepare(fixture, ids);
		advance(prepared.task);
		const result = prepared.task.finish();
		const expected = [...ids]
			.sort((left, right) => left - right)
			.flatMap((id) => discoverStaticFabAssemblyGateways(fixture.map, fixture.organizations, id));
		expect(result.gateways).toEqual(expected);
		for (const id of ids) {
			const owner = result.gateways.filter((gateway) => gateway.organizationId === id);
			expect(owner.length).toBe(STATIC_FAB_ASSEMBLY_GATEWAY_LIMIT);
			expect(
				owner.every(
					(gateway) => gateway.runLengthMeters >= STATIC_FAB_ASSEMBLY_GATEWAY_MINIMUM_RUN_METERS,
				),
			).toBe(true);
			expect(
				owner.every((gateway) => fixture.map.hasRail(gateway.anchor.x, gateway.anchor.y)),
			).toBe(true);
		}
		expect(
			result.gateways.some((gateway) => gateway.organizationId === 1 && gateway.anchor.y === 0),
		).toBe(false);
		prepared.metadataLookup.revoke();
	});

	it("keeps the exact 100k-record source launch turn at the 128-operation cooperative cap (no latency claim)", () => {
		const fixture = largeLaunchFixture(100_000);
		expect(fixture.organizations.records).toHaveLength(100_000);
		const ids = bayIds(fixture);
		const prepared = prepare(fixture, ids);
		expect(prepared.task.step(100_000)).toBe(128);
		expect(prepared.task.done).toBe(false);
		prepared.task.cancel();
		expectCode(() => prepared.task.finish(), "CANCELLED");
		expect(prepared.metadataLookup.record(ids[0])).toBeDefined();
		prepared.metadataLookup.revoke();
	});

	it("uses checks===4 only as an early source-guard cancellation oracle", () => {
		const fixture = placeProductionBays([
			{ x: 0, y: 0 },
			{ x: 100, y: 0 },
		]);
		const ids = bayIds(fixture);
		let checks = 0;
		// This is intentionally an early guard oracle; child traversal cancellation is covered by
		// StaticFabAssemblyConnectorLaunch.child-cancel.test.ts using real forwarded generators.
		const prepared = prepare(fixture, ids, () => {
			if (++checks === 4) task.cancel();
			return true;
		});
		const task: SourceBoundCooperativeTask<StaticFabAssemblyConnectorLaunchResult> = prepared.task;
		expectCode(() => task.step(128), "CANCELLED");
		expectCode(() => task.finish(), "CANCELLED");
		expect(prepared.metadataLookup.record(ids[0])).toBeDefined();
		prepared.metadataLookup.revoke();
	});

	it.each([1, 2])("rejects source cancellation at final publication callback %i", (cancelAt) => {
		const fixture = placeProductionBays([
			{ x: 0, y: 0 },
			{ x: 100, y: 0 },
		]);
		const ids = bayIds(fixture);
		let finishing = false;
		let checks = 0;
		const prepared = prepare(fixture, ids, () => {
			if (finishing && ++checks === cancelAt) task.cancel();
			return true;
		});
		const task: SourceBoundCooperativeTask<StaticFabAssemblyConnectorLaunchResult> = prepared.task;
		advance(task);
		finishing = true;
		let published: unknown;
		expectCode(() => {
			published = task.finish();
		}, "CANCELLED");
		expect(published).toBeUndefined();
		expect(prepared.metadataLookup.record(ids[0])).toBeDefined();
		prepared.metadataLookup.revoke();
	});

	it("captures pair/source fields before callbacks and rejects map ABA, forged, and foreign results", () => {
		const fixture = placeProductionBays([
			{ x: 0, y: 0 },
			{ x: 100, y: 0 },
		]);
		const ids = bayIds(fixture);
		const metadataLookup = metadata(fixture.organizations);
		const pair = [ids[1], ids[0]] as [number, number];
		const raw = input(fixture, metadataLookup, pair);
		const captured = captureStaticFabAssemblyConnectorLaunchInput(raw);
		pair[0] = 999_999;
		// Replace mutable caller fields after capture; the task must retain only its frozen request.
		Object.assign(raw, {
			map: placeProductionBays([{ x: 800, y: 0 }]).map,
			organizationIds: [999, 1000],
		});
		const task = createStaticFabAssemblyConnectorLaunchPreparation(captured);
		advance(task);
		const result = task.finish();
		expect(result.organizationIds).toEqual([Math.min(ids[0], ids[1]), Math.max(ids[0], ids[1])]);
		expect(() =>
			assertStaticFabAssemblyConnectorLaunchResultCurrent({ ...result }, captured),
		).toThrow(/unissued/i);
		const other = placeProductionBays([
			{ x: 300, y: 0 },
			{ x: 400, y: 0 },
		]);
		const otherPrepared = prepare(other, bayIds(other));
		advance(otherPrepared.task);
		const otherResult = otherPrepared.task.finish();
		assertStaticFabAssemblyConnectorLaunchResultCurrent(otherResult, otherPrepared.request);
		expectCode(
			() => assertStaticFabAssemblyConnectorLaunchResultCurrent(result, otherPrepared.request),
			"FOREIGN_RESULT",
		);
		otherPrepared.metadataLookup.revoke();
		metadataLookup.revoke();

		const staleFixture = placeProductionBays([
			{ x: 0, y: 0 },
			{ x: 100, y: 0 },
		]);
		const staleIds = bayIds(staleFixture);
		let changed = false;
		const stale = prepare(staleFixture, staleIds, () => {
			if (!changed) {
				changed = true;
				staleFixture.map.setEncoded(9999, 9999, 0x11);
			}
			return true;
		});
		expectCode(() => stale.task.step(), "STALE_SOURCE");
		expectCode(() => stale.task.finish(), "STALE_SOURCE");
		stale.metadataLookup.revoke();
	});

	it.each([
		["truthy object", "step"],
		["Promise<false>", "step"],
		["truthy object", "finish"],
		["Promise<false>", "finish"],
		["truthy object", "admission"],
		["Promise<false>", "admission"],
	] as const)("refuses %s predicate at %s with exactly one failing callback", (valueKind, boundary) => {
		const fixture = placeProductionBays([
			{ x: 0, y: 0 },
			{ x: 100, y: 0 },
		]);
		const ids = bayIds(fixture);
		let calls = 0;
		let allowed = true;
		const invalidValue = valueKind === "truthy object" ? {} : Promise.resolve(false);
		// Explicit unsafe adapter fixture: production port is synchronous boolean-only.
		const predicate = (() => {
			calls++;
			return allowed ? true : invalidValue;
		}) as unknown as StaticFabAssemblyConnectorLaunchInput["isSourceCurrent"];
		const prepared = prepare(fixture, ids, predicate);
		expect(calls).toBe(0); // capture and task construction do not call the predicate.
		try {
			let result: StaticFabAssemblyConnectorLaunchResult | undefined;
			if (boundary !== "step") advance(prepared.task);
			if (boundary === "admission") result = prepared.task.finish();
			const before = calls;
			allowed = false;
			let published: StaticFabAssemblyConnectorLaunchResult | undefined;
			if (boundary === "step") expectCode(() => prepared.task.step(128), "STALE_SOURCE");
			else if (boundary === "finish")
				expectCode(() => {
					published = prepared.task.finish();
				}, "STALE_SOURCE");
			else
				expectCode(
					() =>
						assertStaticFabAssemblyConnectorLaunchResultCurrent(
							result as StaticFabAssemblyConnectorLaunchResult,
							prepared.request,
						),
					"STALE_SOURCE",
				);
			expect(calls - before).toBe(1);
			expect(published).toBeUndefined();
			if (boundary !== "admission") {
				expectCode(() => prepared.task.finish(), "STALE_SOURCE");
				expect(calls - before).toBe(1); // Terminal failure cannot invoke another callback.
			}
			expect(prepared.metadataLookup.record(ids[0])).toBeDefined();
		} finally {
			prepared.task.cancel();
			prepared.metadataLookup.revoke();
		}
	});

	it.each([
		["map undefined", { map: undefined }],
		["map null", { map: null }],
		["map primitive", { map: false }],
		["map missing method", { map: {} }],
		["map method undefined", { map: { getRevision: undefined } }],
		["map method not callable", { map: { getRevision: 0 } }],
		["organizations undefined", { organizations: undefined }],
		["organizations null", { organizations: null }],
		["organizations primitive", { organizations: false }],
		["lookup undefined", { metadataLookup: undefined }],
		["lookup null", { metadataLookup: null }],
		["lookup primitive", { metadataLookup: false }],
		["predicate missing", { isSourceCurrent: undefined }],
		["pair missing", { organizationIds: undefined }],
		["pair not array", { organizationIds: {} }],
		["pair short", { organizationIds: [1] }],
		["pair zero ID", { organizationIds: [0, 1] }],
		["pair outside Int32", { organizationIds: [1, 0x80000000] }],
		["revision missing", { capturedMapRevision: undefined }],
		["revision negative", { capturedMapRevision: -1 }],
		["revision nonfinite", { capturedMapRevision: Number.NaN }],
	] as const)("rejects malformed %s as INVALID_INPUT before any source callback", (_label, override) => {
		const fixture = placeProductionBays([
			{ x: 0, y: 0 },
			{ x: 100, y: 0 },
		]);
		const ids = bayIds(fixture);
		const lookup = metadata(fixture.organizations);
		let calls = 0;
		const valid = input(fixture, lookup, ids, () => {
			calls++;
			return true;
		});
		const malformed = { ...valid, ...override } as unknown as StaticFabAssemblyConnectorLaunchInput;
		try {
			expectCode(() => captureStaticFabAssemblyConnectorLaunchInput(malformed), "INVALID_INPUT");
			expect(calls).toBe(0);
			expectCode(
				() => createStaticFabAssemblyConnectorLaunchPreparation(malformed),
				"INVALID_INPUT",
			);
			expect(calls).toBe(0);
			expect(lookup.record(ids[0])).toBeDefined();
		} finally {
			lookup.revoke();
		}
	});

	it.each([
		undefined,
		null,
		false,
		0,
		"not input",
	])("rejects raw malformed input %s before callbacks", (raw) => {
		expectCode(
			() =>
				captureStaticFabAssemblyConnectorLaunchInput(
					raw as unknown as StaticFabAssemblyConnectorLaunchInput,
				),
			"INVALID_INPUT",
		);
		expectCode(
			() =>
				createStaticFabAssemblyConnectorLaunchPreparation(
					raw as unknown as StaticFabAssemblyConnectorLaunchInput,
				),
			"INVALID_INPUT",
		);
	});
});
