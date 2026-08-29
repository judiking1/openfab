import { beforeAll, describe, expect, it } from "vitest";
import {
	type CertifiedOpenFabFabComposition,
	composeOpenFabFab,
} from "../compile/OpenFabFabComposer";
import { defaultOpenFabFabProfile } from "../compile/OpenFabFabProfile";
import { checksumRailMap } from "../worker/RailMirrorChecksum";
import { hydrateRailMirrorSnapshotDocument } from "../worker/RailMirrorSnapshotDocument";
import type { PortEquipmentState } from "./EquipmentGroup";
import { analyzeRailNetwork } from "./network";
import type { CardinalPortRoute, PortRecord } from "./PortRecord";
import {
	ALL_DIRECTIONS,
	bitCount,
	type Direction,
	directionBetween,
	moveCell,
	oppositeDirection,
} from "./railShape";
import {
	assertStaticFabBayFlowEditAppliedProjection,
	planStaticFabBayFlowEditWithProspectiveState,
	STATIC_FAB_BAY_FLOW_EDIT_KIND,
	STATIC_FAB_BAY_FLOW_EDIT_VERSION,
	staticFabBayFlowEditHierarchyEligibility,
	staticFabBayFlowEditIntentError,
} from "./StaticFabBayFlowEdit";
import {
	compareDirectedRailEdges,
	copyStaticFabOrganizationRecord,
	deriveStaticFabOrganizationSemanticRoles,
	replaceStaticFabOrganizationRecordMembership,
	staticFabOrganizationParentIds,
	staticFabOrganizationStateError,
} from "./StaticFabOrganization";
import { decodeRailCell, encodeRailCell } from "./TileMap";

const MINIMUM_TWIN_PROFILE = Object.freeze({
	...defaultOpenFabFabProfile(),
	layoutBlockCount: 1 as const,
	banksPerLayoutBlock: 1 as const,
	processLoopsPerBank: 12 as const,
	bayPackingPolicy: "TWIN" as const,
	processLoopLongAxisMeters: 36 as const,
	processLoopCenterPitchMeters: 12 as const,
});

describe("StaticFabBayFlowEdit", () => {
	let composition: CertifiedOpenFabFabComposition;
	let balancedComposition: CertifiedOpenFabFabComposition;

	beforeAll(() => {
		composition = composeOpenFabFab(MINIMUM_TWIN_PROFILE);
		balancedComposition = composeOpenFabFab(defaultOpenFabFabProfile());
	}, 120_000);

	it("accepts only one explicit versioned target pattern", () => {
		expect(
			staticFabBayFlowEditIntentError({
				version: STATIC_FAB_BAY_FLOW_EDIT_VERSION,
				bayOrganizationId: 3,
				targetInternalFlowPattern: "co-rotating",
			}),
		).toBeNull();
		expect(
			staticFabBayFlowEditIntentError({
				version: STATIC_FAB_BAY_FLOW_EDIT_VERSION,
				bayOrganizationId: 3,
				targetInternalFlowPattern: "co-rotating",
				toggle: true,
			}),
		).toMatch(/fields/);
		expect(
			staticFabBayFlowEditIntentError({
				version: STATIC_FAB_BAY_FLOW_EDIT_VERSION,
				bayOrganizationId: 3,
				targetInternalFlowPattern: "random",
			}),
		).toMatch(/target pattern/);
	});

	it("enables the command only for an exact two-Process-Loop hierarchy", () => {
		const document = hydrateRailMirrorSnapshotDocument(composition.roundTrippedSnapshot);
		const selected = firstBayAndBank(document.organizations);
		expect(
			staticFabBayFlowEditHierarchyEligibility(document.organizations, selected.bayId),
		).toMatchObject({ valid: true, issueCode: null });

		const directChildren = document.organizations.records.filter((record) =>
			staticFabOrganizationParentIds(record).includes(selected.bayId),
		);
		expect(directChildren).toHaveLength(2);
		const firstChild = directChildren[0];
		const removedChild = directChildren[1];
		if (!firstChild || !removedChild) throw new Error("Expected two Process Loop children.");
		const singleLoopHierarchy = Object.freeze({
			...document.organizations,
			records: Object.freeze(
				document.organizations.records.filter((record) => record.id !== removedChild.id),
			),
		});
		expect(
			staticFabBayFlowEditHierarchyEligibility(singleLoopHierarchy, selected.bayId),
		).toMatchObject({
			valid: false,
			issueCode: "UNSUPPORTED_HIERARCHY",
			reason: expect.stringMatching(/Twin Bay/),
		});

		const detachedHierarchy = Object.freeze({
			...document.organizations,
			records: Object.freeze(
				document.organizations.records.map((record) =>
					record.id === selected.bayId
						? Object.freeze({ ...record, parentOrganizationIds: Object.freeze([]) })
						: record,
				),
			),
		});
		expect(
			staticFabBayFlowEditHierarchyEligibility(detachedHierarchy, selected.bayId),
		).toMatchObject({ valid: true, issueCode: null });

		const ambiguousParentHierarchy = Object.freeze({
			...document.organizations,
			records: Object.freeze(
				document.organizations.records.map((record) =>
					record.id === selected.bayId
						? Object.freeze({
								...record,
								parentOrganizationIds: Object.freeze(
									[selected.bankId, firstChild.id].sort((left, right) => left - right),
								),
							})
						: record,
				),
			),
		});
		expect(
			staticFabBayFlowEditHierarchyEligibility(ambiguousParentHierarchy, selected.bayId),
		).toMatchObject({ valid: false, issueCode: "UNSUPPORTED_HIERARCHY" });

		const nestedOrganizationId = document.organizations.nextOrganizationId;
		const nestedHierarchy = Object.freeze({
			nextOrganizationId: nestedOrganizationId + 1,
			records: Object.freeze([
				...document.organizations.records,
				Object.freeze({
					id: nestedOrganizationId,
					kind: "PROCESS_FAMILY" as const,
					name: "Nested unsupported organization",
					parentOrganizationIds: Object.freeze([firstChild.id]),
					membership: Object.freeze({
						railEdges: Object.freeze([]),
						advancedSwitchIds: Object.freeze([]),
						equipmentGroupIds: Object.freeze([]),
					}),
				}),
			]),
		});
		expect(staticFabBayFlowEditHierarchyEligibility(nestedHierarchy, selected.bayId)).toMatchObject(
			{ valid: false, issueCode: "UNSUPPORTED_HIERARCHY" },
		);
	});

	it("distinguishes the default balanced profile's Single and Twin Bay records", () => {
		const document = hydrateRailMirrorSnapshotDocument(balancedComposition.roundTrippedSnapshot);
		const single = document.organizations.records.find(
			(record) => record.name === "Production Bay 1.1",
		);
		const twin = document.organizations.records.find(
			(record) => record.name === "Production Bay 1.2",
		);
		if (!single || !twin) throw new Error("Expected the canonical balanced Bay records.");

		expect(
			staticFabBayFlowEditHierarchyEligibility(document.organizations, single.id),
		).toMatchObject({ valid: false, issueCode: "UNSUPPORTED_HIERARCHY" });
		expect(staticFabBayFlowEditHierarchyEligibility(document.organizations, twin.id)).toMatchObject(
			{ valid: true, issueCode: null },
		);

		const result = planStaticFabBayFlowEditWithProspectiveState(
			document.map,
			document.portEquipment,
			document.getPatchSequence(),
			document.organizations,
			{
				version: STATIC_FAB_BAY_FLOW_EDIT_VERSION,
				bayOrganizationId: twin.id,
				targetInternalFlowPattern: "co-rotating",
			},
		);
		expect(result.plan.valid, result.plan.reason).toBe(true);
		const prospective = result.prospectiveState;
		if (!prospective) throw new Error(result.plan.reason);
		expect(() =>
			assertStaticFabBayFlowEditAppliedProjection(
				document.map,
				document.organizations,
				result.plan.review,
				"source",
			),
		).not.toThrow();
		expect(() =>
			assertStaticFabBayFlowEditAppliedProjection(
				prospective.map,
				prospective.organizations,
				result.plan.review,
				"target",
			),
		).not.toThrow();
	});

	it("replaces one attached Twin Bay flow while preserving its Bank and every outside record", () => {
		const document = hydrateRailMirrorSnapshotDocument(composition.roundTrippedSnapshot);
		const sourceChecksum = authoredChecksum(document);
		const selected = firstBayAndBank(document.organizations);

		const result = planStaticFabBayFlowEditWithProspectiveState(
			document.map,
			document.portEquipment,
			document.getPatchSequence(),
			document.organizations,
			{
				version: STATIC_FAB_BAY_FLOW_EDIT_VERSION,
				bayOrganizationId: selected.bayId,
				targetInternalFlowPattern: "co-rotating",
			},
		);

		expect(result.plan).toMatchObject({
			kind: STATIC_FAB_BAY_FLOW_EDIT_KIND,
			valid: true,
			issueCode: null,
			switchMutations: [],
			portMutations: [],
			equipmentGroupMutations: [],
			nextOrganizationIdBefore: document.organizations.nextOrganizationId,
			nextOrganizationIdAfter: document.organizations.nextOrganizationId,
			review: {
				bayOrganizationId: selected.bayId,
				bankOrganizationId: selected.bankId,
				sourceInternalFlowPattern: "alternating",
				targetInternalFlowPattern: "co-rotating",
				incidentConnectorCount: 1,
				issueCode: null,
			},
		});
		expect(result.plan.mutations.length).toBeGreaterThan(0);
		expect(result.plan.organizationMutations.length).toBeGreaterThan(0);
		expect(result.plan.review.removedDirectedEdgeCount).toBeGreaterThan(0);
		expect(result.plan.review.addedDirectedEdgeCount).toBe(
			result.plan.review.removedDirectedEdgeCount,
		);
		const prospective = requireProspective(result);
		expect(prospective.map.edgeCount).toBe(document.map.edgeCount);
		expect(prospective.portEquipment).toBe(document.portEquipment);
		expect(
			staticFabOrganizationStateError(
				prospective.map,
				prospective.portEquipment,
				prospective.organizations,
			),
		).toBeNull();
		expect(analyzeRailNetwork(prospective.map)).toMatchObject({
			status: "closed",
			components: 1,
			strongComponents: 1,
			openEnds: 0,
			unsafeJunctions: 0,
		});
		expect(authoredChecksum(prospective)).not.toBe(sourceChecksum);

		const changedIds = new Set(result.plan.organizationMutations.map((mutation) => mutation.id));
		for (const sourceRecord of document.organizations.records) {
			const targetRecord = prospective.organizations.records.find(
				(record) => record.id === sourceRecord.id,
			);
			if (changedIds.has(sourceRecord.id)) continue;
			expect(targetRecord).toEqual(sourceRecord);
		}
		expect(changedIds.has(selected.bankId)).toBe(false);
	});

	it("rejects selected-Process-Loop equipment without publishing any prospective mutation", () => {
		const document = hydrateRailMirrorSnapshotDocument(composition.roundTrippedSnapshot);
		const selected = firstBayAndBank(document.organizations);
		const processLoop = document.organizations.records.find((record) =>
			staticFabOrganizationParentIds(record).includes(selected.bayId),
		);
		if (!processLoop) throw new Error("Expected one selected Process Loop.");
		const portEquipment = singleFlexEquipmentState(
			regularCardinalRouteForMembership(document.map, processLoop.membership.railEdges),
		);
		const organizations = Object.freeze({
			...document.organizations,
			records: Object.freeze(
				document.organizations.records.map((record) =>
					record.id === processLoop.id
						? replaceStaticFabOrganizationRecordMembership(record, {
								railEdges: record.membership.railEdges,
								advancedSwitchIds: record.membership.advancedSwitchIds,
								equipmentGroupIds: Object.freeze([1]),
							})
						: record,
				),
			),
		});
		expect(staticFabOrganizationStateError(document.map, portEquipment, organizations)).toBeNull();
		const sourceChecksum = checksumRailMap(document.map, portEquipment, organizations);

		const result = planStaticFabBayFlowEditWithProspectiveState(
			document.map,
			portEquipment,
			document.getPatchSequence(),
			organizations,
			flowIntent(selected.bayId),
		);

		assertUnsupportedDependency(result, /advanced switches or equipment groups/);
		expect(checksumRailMap(document.map, portEquipment, organizations)).toBe(sourceChecksum);
	});

	it("rejects an unassigned port inside the selected Bay envelope without changing source truth", () => {
		const document = hydrateRailMirrorSnapshotDocument(composition.roundTrippedSnapshot);
		const selected = firstBayAndBank(document.organizations);
		const bay = document.organizations.records.find((record) => record.id === selected.bayId);
		if (!bay) throw new Error("Expected the selected Bay record.");
		const portEquipment = singleFlexEquipmentState(
			regularCardinalRouteForMembership(document.map, bay.membership.railEdges),
		);
		expect(
			staticFabOrganizationStateError(document.map, portEquipment, document.organizations),
		).toBeNull();
		const sourceChecksum = checksumRailMap(document.map, portEquipment, document.organizations);

		const result = planStaticFabBayFlowEditWithProspectiveState(
			document.map,
			portEquipment,
			document.getPatchSequence(),
			document.organizations,
			flowIntent(selected.bayId),
		);

		assertUnsupportedDependency(result, /Port 1 attaches inside the selected Bay envelope/);
		expect(checksumRailMap(document.map, portEquipment, document.organizations)).toBe(
			sourceChecksum,
		);
	});

	it("runtime-recognizes the prospective co-rotating Bay and reverses to exact source truth", () => {
		const document = hydrateRailMirrorSnapshotDocument(composition.roundTrippedSnapshot);
		const selected = firstBayAndBank(document.organizations);
		const forward = planStaticFabBayFlowEditWithProspectiveState(
			document.map,
			document.portEquipment,
			document.getPatchSequence(),
			document.organizations,
			{
				version: STATIC_FAB_BAY_FLOW_EDIT_VERSION,
				bayOrganizationId: selected.bayId,
				targetInternalFlowPattern: "co-rotating",
			},
		);
		const target = requireProspective(forward);

		const reverse = planStaticFabBayFlowEditWithProspectiveState(
			target.map,
			target.portEquipment,
			document.getPatchSequence(),
			target.organizations,
			{
				version: STATIC_FAB_BAY_FLOW_EDIT_VERSION,
				bayOrganizationId: selected.bayId,
				targetInternalFlowPattern: "alternating",
			},
		);

		expect(reverse.plan).toMatchObject({
			valid: true,
			review: {
				sourceInternalFlowPattern: "co-rotating",
				targetInternalFlowPattern: "alternating",
			},
		});
		expect(forward.plan.review.sourceAuthoredProjectionFingerprint).not.toBe(
			forward.plan.review.targetAuthoredProjectionFingerprint,
		);
		expect(reverse.plan.review.sourceAuthoredProjectionFingerprint).toBe(
			forward.plan.review.targetAuthoredProjectionFingerprint,
		);
		expect(reverse.plan.review.targetAuthoredProjectionFingerprint).toBe(
			forward.plan.review.sourceAuthoredProjectionFingerprint,
		);
		const restored = requireProspective(reverse);
		expect(authoredChecksum(restored)).toBe(authoredChecksum(document));
		expect(restored.organizations).toEqual(document.organizations);
		expect(restored.portEquipment).toBe(document.portEquipment);
	});

	it("fail-closes bounded projection validation for gateway drift and foreign membership", () => {
		const document = hydrateRailMirrorSnapshotDocument(composition.roundTrippedSnapshot);
		const selected = firstBayAndBank(document.organizations);
		const result = planStaticFabBayFlowEditWithProspectiveState(
			document.map,
			document.portEquipment,
			document.getPatchSequence(),
			document.organizations,
			{
				version: STATIC_FAB_BAY_FLOW_EDIT_VERSION,
				bayOrganizationId: selected.bayId,
				targetInternalFlowPattern: "co-rotating",
			},
		);
		const prospective = requireProspective(result);
		expect(() =>
			assertStaticFabBayFlowEditAppliedProjection(
				document.map,
				document.organizations,
				result.plan.review,
				"source",
			),
		).not.toThrow();
		expect(() =>
			assertStaticFabBayFlowEditAppliedProjection(
				prospective.map,
				prospective.organizations,
				result.plan.review,
				"target",
			),
		).not.toThrow();

		const gatewayDrift = prospective.map.clone();
		const gatewayKey = result.plan.review.connectorBankToBayDirectedEdgeKeys[0];
		if (!gatewayKey) throw new Error("Expected one attached gateway edge.");
		removeDirectedEdge(gatewayDrift, gatewayKey);
		expect(() =>
			assertStaticFabBayFlowEditAppliedProjection(
				gatewayDrift,
				prospective.organizations,
				result.plan.review,
				"target",
			),
		).toThrow(/fixed gateway edge/);

		const bay = prospective.organizations.records.find((record) => record.id === selected.bayId);
		const bank = prospective.organizations.records.find((record) => record.id === selected.bankId);
		if (!bay || !bank) throw new Error("Expected exact Bay and Bank records.");
		const bankEdgeKeys = new Set(bank.membership.railEdges.map(edgeKey));
		const omittedEdge = bay.membership.railEdges.find((edge) => !bankEdgeKeys.has(edgeKey(edge)));
		if (!omittedEdge) throw new Error("Expected one Bay-only internal edge.");
		const omittedBay = copyStaticFabOrganizationRecord({
			...bay,
			membership: {
				...bay.membership,
				railEdges: bay.membership.railEdges.filter(
					(edge) => edgeKey(edge) !== edgeKey(omittedEdge),
				),
			},
		});
		const omittedOrganizations = Object.freeze({
			...prospective.organizations,
			records: Object.freeze(
				prospective.organizations.records.map((record) =>
					record.id === omittedBay.id ? omittedBay : record,
				),
			),
		});
		expect(() =>
			assertStaticFabBayFlowEditAppliedProjection(
				prospective.map,
				omittedOrganizations,
				result.plan.review,
				"target",
			),
		).toThrow(/not exactly covered/);

		const foreignEdge = bank?.membership.railEdges.find(
			(edge) => !bay.membership.railEdges.some((candidate) => edgeKey(candidate) === edgeKey(edge)),
		);
		if (!foreignEdge) throw new Error("Expected one foreign Bank edge.");
		const forgedBay = copyStaticFabOrganizationRecord({
			...bay,
			membership: {
				...bay.membership,
				railEdges: [...bay.membership.railEdges, foreignEdge].sort(compareDirectedRailEdges),
			},
		});
		const forgedOrganizations = Object.freeze({
			...prospective.organizations,
			records: Object.freeze(
				prospective.organizations.records.map((record) =>
					record.id === forgedBay.id ? forgedBay : record,
				),
			),
		});
		expect(() =>
			assertStaticFabBayFlowEditAppliedProjection(
				prospective.map,
				forgedOrganizations,
				result.plan.review,
				"target",
			),
		).toThrow(/outside the fixed-gateway component/);
	});

	it("rejects an explicit no-op without publishing prospective state", () => {
		const document = hydrateRailMirrorSnapshotDocument(composition.roundTrippedSnapshot);
		const selected = firstBayAndBank(document.organizations);
		const result = planStaticFabBayFlowEditWithProspectiveState(
			document.map,
			document.portEquipment,
			document.getPatchSequence(),
			document.organizations,
			{
				version: STATIC_FAB_BAY_FLOW_EDIT_VERSION,
				bayOrganizationId: selected.bayId,
				targetInternalFlowPattern: "alternating",
			},
		);

		expect(result.prospectiveState).toBeNull();
		expect(result.plan).toMatchObject({
			valid: false,
			issueCode: "TARGET_NOOP",
			mutations: [],
			organizationMutations: [],
		});
	});
});

function firstBayAndBank(organizations: {
	readonly records: readonly {
		readonly id: number;
		readonly parentOrganizationIds?: readonly number[];
	}[];
}): { readonly bayId: number; readonly bankId: number } {
	const state = organizations as Parameters<typeof deriveStaticFabOrganizationSemanticRoles>[0];
	const roles = deriveStaticFabOrganizationSemanticRoles(state);
	const bay = state.records.find((record) => roles.get(record.id) === "BAY");
	if (!bay) throw new Error("Expected one generated Twin Bay.");
	const bankId = staticFabOrganizationParentIds(bay).find((id) => roles.get(id) === "BAY_BANK");
	if (!bankId) throw new Error("Expected the selected Bay Bank.");
	return Object.freeze({ bayId: bay.id, bankId });
}

function requireProspective(
	result: ReturnType<typeof planStaticFabBayFlowEditWithProspectiveState>,
) {
	if (!result.plan.valid || !result.prospectiveState) {
		throw new Error(result.plan.reason);
	}
	return result.prospectiveState;
}

function authoredChecksum(source: {
	readonly map: Parameters<typeof checksumRailMap>[0];
	readonly portEquipment: Parameters<typeof checksumRailMap>[1];
	readonly organizations: Parameters<typeof checksumRailMap>[2];
}): string {
	return checksumRailMap(source.map, source.portEquipment, source.organizations);
}

function flowIntent(bayOrganizationId: number) {
	return Object.freeze({
		version: STATIC_FAB_BAY_FLOW_EDIT_VERSION,
		bayOrganizationId,
		targetInternalFlowPattern: "co-rotating" as const,
	});
}

function assertUnsupportedDependency(
	result: ReturnType<typeof planStaticFabBayFlowEditWithProspectiveState>,
	reason: RegExp,
): void {
	expect(result.prospectiveState).toBeNull();
	expect(result.plan).toMatchObject({
		valid: false,
		issueCode: "UNSUPPORTED_DEPENDENCY",
		mutations: [],
		switchMutations: [],
		portMutations: [],
		equipmentGroupMutations: [],
		organizationMutations: [],
		organizationImpactAuthorizations: [],
		review: { issueCode: "UNSUPPORTED_DEPENDENCY" },
	});
	expect(result.plan.reason).toMatch(reason);
}

function regularCardinalRouteForMembership(
	map: Parameters<typeof checksumRailMap>[0],
	edges: readonly {
		readonly from: { readonly x: number; readonly y: number };
		readonly to: { readonly x: number; readonly y: number };
	}[],
): CardinalPortRoute {
	const edgeKeys = new Set(edges.map(edgeKey));
	const cells = new Map<string, Readonly<{ x: number; y: number }>>();
	for (const edge of edges) {
		cells.set(`${edge.from.x}:${edge.from.y}`, edge.from);
		cells.set(`${edge.to.x}:${edge.to.y}`, edge.to);
	}
	for (const cell of [...cells.values()].sort(
		(left, right) => left.x - right.x || left.y - right.y,
	)) {
		const rail = map.getRail(cell.x, cell.y);
		if (bitCount(rail.incoming) !== 1 || bitCount(rail.outgoing) !== 1) continue;
		const from = ALL_DIRECTIONS.find((direction) => (rail.incoming & direction) !== 0);
		const to = ALL_DIRECTIONS.find((direction) => (rail.outgoing & direction) !== 0);
		if (from === undefined || to === undefined || from === to) continue;
		const source = moveCell(cell, from);
		const target = moveCell(cell, to);
		if (
			!edgeKeys.has(edgeKey({ from: source, to: cell })) ||
			!edgeKeys.has(edgeKey({ from: cell, to: target }))
		) {
			continue;
		}
		return Object.freeze({
			kind: "CARDINAL_CELL",
			x: cell.x,
			z: cell.y,
			from: from as Direction,
			to: to as Direction,
		});
	}
	throw new Error("Expected a regular cardinal route in selected Bay membership.");
}

function singleFlexEquipmentState(route: CardinalPortRoute): PortEquipmentState {
	const port = Object.freeze({
		id: 1,
		equipmentGroupId: 1,
		route,
		stationMillimeters: 500,
		side: "CENTER",
		lateralOffsetMillimeters: 0,
		direction: "WITH_TRAVEL",
		portType: "STK",
		barcode: null,
	}) satisfies PortRecord;
	return Object.freeze({
		nextPortId: 2,
		nextEquipmentGroupId: 2,
		ports: Object.freeze([port]),
		equipmentGroups: Object.freeze([
			Object.freeze({
				id: 1,
				kind: "STK" as const,
				portIds: Object.freeze([1]),
				template: "FLEX" as const,
			}),
		]),
	});
}

function edgeKey(edge: {
	readonly from: { x: number; y: number };
	readonly to: { x: number; y: number };
}): string {
	return `${edge.from.x}:${edge.from.y}>${edge.to.x}:${edge.to.y}`;
}

function removeDirectedEdge(
	map: Parameters<typeof assertStaticFabBayFlowEditAppliedProjection>[0],
	key: string,
): void {
	const match = /^(-?\d+):(-?\d+)>(-?\d+):(-?\d+)$/.exec(key);
	if (!match) throw new Error(`Malformed test edge ${key}.`);
	const [fromX, fromY, toX, toY] = match.slice(1).map(Number) as [number, number, number, number];
	const from = { x: fromX, y: fromY };
	const to = { x: toX, y: toY };
	const direction = directionBetween(from, to);
	if (direction === null) throw new Error(`Non-cardinal test edge ${key}.`);
	const opposite = oppositeDirection(direction);
	const source = decodeRailCell(map.getEncoded(from.x, from.y));
	const target = decodeRailCell(map.getEncoded(to.x, to.y));
	if (
		!map.applyAtomicMutations(
			[
				{
					x: from.x,
					y: from.y,
					before: map.getEncoded(from.x, from.y),
					after: encodeRailCell({ ...source, outgoing: source.outgoing & ~direction }),
				},
				{
					x: to.x,
					y: to.y,
					before: map.getEncoded(to.x, to.y),
					after: encodeRailCell({ ...target, incoming: target.incoming & ~opposite }),
				},
			],
			[],
		)
	) {
		throw new Error(`Could not remove test edge ${key}.`);
	}
}
