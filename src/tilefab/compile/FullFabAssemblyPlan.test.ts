import { describe, expect, it } from "vitest";
import { DIR_E, DIR_N, DIR_S, DIR_W } from "../core/railShape";
import { createFullFabAssemblyPlan, fullFabMinimumPitchMeters } from "./FullFabAssemblyPlan";

const DEFAULT_PROFILE = Object.freeze({
	bayCount: 52,
	bayDepthMeters: 104,
	bayFrontageMeters: 40,
	bayPitchMeters: 44,
});

describe("FullFabAssemblyPlan", () => {
	it("builds one factory perimeter around two halls, four Banks, and 52 large Bays", () => {
		const plan = createFullFabAssemblyPlan(DEFAULT_PROFILE);

		expect(plan.id).toBe("full-fab-52");
		expect(plan.halls).toHaveLength(2);
		expect(plan.banks).toHaveLength(4);
		expect(plan.banks.map((bank) => bank.bays.length)).toEqual([13, 13, 13, 13]);
		expect(plan.banks.flatMap((bank) => bank.bays)).toHaveLength(52);
		expect(plan.banks.flatMap((bank) => bank.bays.flatMap((bay) => bay.processLoops))).toHaveLength(
			104,
		);
		expect(plan.gateways).toHaveLength(8);
		expect(plan.outer.lengthMeters).toBe(632);
		expect(plan.outer.depthMeters).toBe(608);
	});

	it("keeps all nested Process Loops slender and inside their Bay depth", () => {
		const plan = createFullFabAssemblyPlan(DEFAULT_PROFILE);

		for (const bay of plan.banks.flatMap((bank) => bank.bays)) {
			expect(bay.processLoops).toHaveLength(2);
			for (const loop of bay.processLoops) {
				expect(loop.depthMeters).toBeLessThan(bay.depthMeters);
				expect(loop.depthMeters / loop.frontageMeters).toBeGreaterThanOrEqual(6);
			}
		}
	});

	it("is deterministic and changes identity across every public sizing axis", () => {
		const base = createFullFabAssemblyPlan(DEFAULT_PROFILE);
		expect(createFullFabAssemblyPlan(DEFAULT_PROFILE).planFingerprint).toBe(base.planFingerprint);
		for (const profile of [
			{ ...DEFAULT_PROFILE, bayCount: 56 },
			{ ...DEFAULT_PROFILE, bayDepthMeters: 108 },
			{ ...DEFAULT_PROFILE, bayFrontageMeters: 44, bayPitchMeters: 48 },
			{ ...DEFAULT_PROFILE, bayPitchMeters: 48 },
		]) {
			expect(createFullFabAssemblyPlan(profile).planFingerprint).not.toBe(base.planFingerprint);
		}
	});

	it("rejects partial Banks and spacing without the modular service gap", () => {
		expect(fullFabMinimumPitchMeters(40)).toBe(44);
		expect(() => createFullFabAssemblyPlan({ ...DEFAULT_PROFILE, bayCount: 50 })).toThrow(
			/divisible by four/,
		);
		expect(() => createFullFabAssemblyPlan({ ...DEFAULT_PROFILE, bayDepthMeters: 124 })).toThrow(
			/80-120 m/,
		);
		expect(() => createFullFabAssemblyPlan({ ...DEFAULT_PROFILE, bayPitchMeters: 40 })).toThrow(
			/at least 4 m/,
		);
	});

	it("binds all eight gateway contracts and four Bank contacts across profile corners", () => {
		for (const bayCount of [48, 64])
			for (const bayDepthMeters of [80, 120])
				for (const bayFrontageMeters of [36, 60])
					for (const bayPitchMeters of [fullFabMinimumPitchMeters(bayFrontageMeters), 76]) {
						const plan = createFullFabAssemblyPlan({
							bayCount,
							bayDepthMeters,
							bayFrontageMeters,
							bayPitchMeters,
						});
						expect(plan.relationships.organizationKeys).toEqual([
							"FULL-FAB",
							...plan.banks.map((bank) => bank.id),
						]);
						expect(plan.relationships.relationships.nextRelationshipId).toBe(5);
						expect(
							plan.relationships.relationships.records.map(
								(record) => record.participantOrganizationIds,
							),
						).toEqual([[2], [3], [4], [5]]);
						const runIds: string[] = [];
						for (const [index, gateway] of plan.gateways.entries()) {
							const type = index % 4;
							const hall = plan.halls[Math.floor(index / 4)];
							if (!hall) throw new Error("Expected Hall.");
							const { contract, sourceAnchor: a, targetAnchor: b } = gateway;
							const perimeter = type < 2;
							const sourceDirection = type === 0 ? DIR_N : type === 1 ? DIR_S : DIR_W;
							const targetDirection = perimeter ? sourceDirection : DIR_E;
							const departure =
								type === 0
									? hall.interbaySpine.origin.y + 11
									: type === 1
										? hall.interbaySpine.origin.y + 9
										: a.x;
							const arrival = departure + (type === 1 ? 8 : -8);
							expect(contract.exactJunctions).toEqual(
								perimeter
									? {
											sourceDeparture: { x: a.x, y: departure },
											sourceArrival: { x: a.x, y: arrival },
											targetArrival: { x: b.x, y: departure },
											targetDeparture: { x: b.x, y: arrival },
										}
									: {
											sourceDeparture: a,
											sourceArrival: { x: arrival, y: a.y },
											targetArrival: b,
											targetDeparture: { x: arrival, y: b.y },
										},
							);
							expect(gateway.allowSameComponent).toBe(type === 1);
							expect(contract.sourceRun).toMatchObject({
								id: `${gateway.id}-SOURCE`,
								ownerId: type === 2 ? gateway.ownerId : "FULL-FAB",
								axis: perimeter ? "y" : "x",
								side: perimeter ? (type === 0 ? "west" : "east") : "south",
								fixedCoordinate: perimeter ? a.x : a.y,
								flowDirection: sourceDirection,
								minimum: Math.min(departure, arrival),
								maximum: Math.max(departure, arrival),
								anchor: contract.exactJunctions.sourceDeparture,
							});
							expect(contract.targetRun).toMatchObject({
								id: `${gateway.id}-TARGET`,
								ownerId: type === 3 ? gateway.ownerId : "FULL-FAB",
								axis: perimeter ? "y" : "x",
								side: perimeter ? (type === 0 ? "west" : "east") : "north",
								fixedCoordinate: perimeter ? b.x : b.y,
								flowDirection: targetDirection,
								minimum: Math.min(departure, arrival),
								maximum: Math.max(departure, arrival),
								anchor: contract.exactJunctions.targetArrival,
							});
							expect(contract.corridor).toEqual(
								perimeter
									? {
											minX: a.x,
											maxX: b.x,
											minY: Math.min(departure, arrival),
											maxY: Math.max(departure, arrival),
										}
									: { minX: arrival, maxX: departure, minY: a.y, maxY: b.y },
							);
							expect([contract.expectedOutboundTurns, contract.expectedReturnTurns]).toEqual([
								0, 0,
							]);
							expect(Object.isFrozen(contract.exactJunctions.sourceArrival)).toBe(true);
							expect(Object.isFrozen(contract.sourceRun)).toBe(true);
							runIds.push(contract.sourceRun.id, contract.targetRun.id);
						}
						expect(new Set(runIds).size).toBe(16);
						for (const [index, record] of plan.relationships.relationships.records.entries()) {
							expect(record).toMatchObject({
								id: index + 1,
								parentOrganizationId: 1,
								managedChildOrganizationIds: [index + 2],
								hierarchyRole: "BANK_TO_FAB",
								purpose: "HIERARCHY_LINK",
								reviewPolicy: "AUTHORING_NON_DETACHABLE",
							});
							expect(record.connectionGroups).toHaveLength(1);
							const leg = record.connectionGroups[0]?.legs[0];
							expect(leg).toMatchObject({
								directionRole: "CONTACT",
								exclusiveCutEdges: [],
								endpointSupports: [],
							});
							expect(leg?.seamContacts.map((seam) => seam.role)).toEqual(
								index % 2 === 0 ? ["BRANCH", "MERGE"] : ["MERGE", "BRANCH"],
							);
						}
					}
	});
});
