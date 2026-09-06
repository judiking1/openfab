import { describe, expect, it } from "vitest";
import {
	certifyProductionBayModuleCatalogRequest,
	defaultProductionBayModuleCatalogRequest,
} from "../compile/ProductionBayModuleCatalog";
import {
	captureOpenFabProject,
	createOpenFabProjectManifest,
	createRailSnapshotFromOpenFabProject,
} from "../project/OpenFabProject";
import { parseOpenFabProjectJson, serializeOpenFabProject } from "../project/OpenFabProjectCodec";
import { captureRailMirrorSnapshot } from "../worker/RailMirrorChecksum";
import { RailPatchMirror } from "../worker/RailPatchMirror";
import { hydrateStaticFabAssemblyRelationshipSnapshot } from "../worker/StaticFabAssemblyRelationshipSoA";
import { emptyPortEquipmentState } from "./EquipmentGroup";
import { planRailPath } from "./paint";
import { RailDocument, type RailPatchEvent } from "./RailDocument";
import { buildRailModuleOwnershipIndex, planRailModuleBulldoze } from "./RailModuleOwnership";
import {
	discoverStaticFabAssemblyGateways,
	discoverStaticFabOuterCirculationGateways,
	planStaticFabAssemblyConnectorWithProspectiveState,
	STATIC_FAB_ASSEMBLY_CONNECTOR_VERSION,
	type StaticFabAssemblyConnectorPlanningResult,
	staticFabAssemblyConnectorAddedDirectedEdges,
	staticFabAssemblyConnectorHierarchyEligibility,
	staticFabAssemblyInterbayConnectorHierarchyEligibility,
} from "./StaticFabAssemblyConnector";
import { describeStaticFabAssemblyConnectorRelationship } from "./StaticFabAssemblyConnectorRelationshipDescriptor";
import {
	copyStaticFabAssemblyRelationshipState,
	remapStaticFabAssemblyRelationshipRecord,
	type StaticFabAssemblyRelationshipRecordV1,
	type StaticFabAssemblyRelationshipStateV1,
	staticFabAssemblyRelationshipStateSourceError,
} from "./StaticFabAssemblyRelationship";
import { validateStaticFabAssemblyRelationshipSourceActivation } from "./StaticFabAssemblyRelationshipActivation";
import {
	compareDirectedRailEdges,
	copyStaticFabOrganizationRecord,
	copyStaticFabOrganizationState,
	deriveStaticFabOrganizationSemanticRoles,
	emptyStaticFabOrganizationState,
	type StaticFabOrganizationState,
	staticFabOrganizationEdgeKey,
	staticFabOrganizationParentIds,
	staticFabOrganizationRailStateError,
} from "./StaticFabOrganization";
import {
	planStaticFabOrganizationBundlePlacementWithProspectiveState,
	type StaticFabOrganizationBundlePlacementProspectiveState,
} from "./StaticFabOrganizationBundlePlacement";
import { type Cell, encodeRailCell, TileMap } from "./TileMap";

interface FixtureState extends StaticFabOrganizationBundlePlacementProspectiveState {
	readonly patchSequence: number;
}

describe("explicit Connector relationship descriptors", () => {
	it.each([
		{ x: 100, y: 0 },
		{ x: 100, y: 40 },
		{ x: 0, y: 100 },
	])("describes both complete legs for a detached pair at %j", (target) => {
		const source = placeProductionBays([{ x: 0, y: 0 }, target]);
		const bays = source.organizations.records.filter((record) => record.kind === "BAY");
		const planning = firstValidConnector(source, required(bays[0]).id, required(bays[1]).id);
		const before = JSON.stringify({ organizations: source.organizations, plan: planning.plan });
		const descriptor = describeStaticFabAssemblyConnectorRelationship(
			source.organizations,
			planning,
			1,
		);
		expect(descriptor.record.participantOrganizationIds).toEqual(bays.map((bay) => bay.id));
		expect(descriptor.record.managedChildOrganizationIds).toEqual(bays.map((bay) => bay.id));
		expect(
			required(descriptor.record.connectionGroups[0]).legs.map((leg) => leg.directionRole),
		).toEqual(["OUTBOUND", "RETURN"]);
		expect(
			required(descriptor.record.connectionGroups[0]).legs.every(
				(leg) =>
					leg.exclusiveCutEdges.length > 1 &&
					leg.endpointSupports.length > 0 &&
					leg.seamContacts.length === 2,
			),
		).toBe(true);
		const firstLeg = required(required(descriptor.record.connectionGroups[0]).legs[0]);
		expect(Object.isFrozen(required(firstLeg.exclusiveCutEdges[0]).edge.from)).toBe(true);
		expect(JSON.stringify({ organizations: source.organizations, plan: planning.plan })).toBe(
			before,
		);
	});

	it.each([
		24, 12,
	])("checks full-module reuse of an explicitly routed existing fragment at %s", (offset) => {
		const source = placeProductionBays([
			{ x: 0, y: 0 },
			{ x: 100, y: 0 },
		]);
		const bays = source.organizations.records.filter((record) => record.kind === "BAY");
		const original = firstValidConnector(source, required(bays[0]).id, required(bays[1]).id);
		const fragment = original.plan.networkLink.outboundCells.slice(offset, offset + 8);
		const prebuilt = planRailPath(source.map, fragment);
		expect(prebuilt.valid).toBe(true);
		expect(
			source.map.applyAtomicMutations(prebuilt.mutations, prebuilt.switchMutations ?? []),
		).toBe(true);
		const metadata = original.plan.assemblyConnector;
		const result = planStaticFabAssemblyConnectorWithProspectiveState(
			source.map,
			source.portEquipment,
			source.patchSequence + 1,
			source.organizations,
			{
				version: metadata.version,
				purpose: required(metadata.purpose),
				sourceOrganizationId: metadata.sourceOrganizationId,
				sourceGatewayId: metadata.sourceGatewayId,
				sourceAnchor: metadata.sourceAnchor,
				targetOrganizationId: metadata.targetOrganizationId,
				targetGatewayId: metadata.targetGatewayId,
				targetAnchor: metadata.targetAnchor,
				side: metadata.requestedSide,
			},
		);
		expect(result.plan.valid).toBe(true);
		const before = JSON.stringify({ plan: result.plan, organizations: source.organizations });
		if (offset === 12) {
			// This fragment remains an unclaimed separate module between the new modules. The
			// descriptor cannot invent ownership or silently bridge a disconnected removal walk.
			expect(() =>
				describeStaticFabAssemblyConnectorRelationship(source.organizations, result, 1),
			).toThrow(/시작점이 유일하지 않습니다/);
		} else {
			const descriptor = describeStaticFabAssemblyConnectorRelationship(
				source.organizations,
				result,
				1,
			);
			const added = new Set(
				staticFabAssemblyConnectorAddedDirectedEdges(result.plan).map(staticFabOrganizationEdgeKey),
			);
			const absorbed = descriptor.record.connectionGroups.flatMap((group) =>
				group.legs.flatMap((leg) =>
					leg.exclusiveCutEdges
						.filter(({ edge }) => !added.has(staticFabOrganizationEdgeKey(edge)))
						.map(({ edge }) => staticFabOrganizationEdgeKey(edge)),
				),
			);
			expect(absorbed).toEqual(
				fragment
					.slice(1)
					.map((to, index) =>
						staticFabOrganizationEdgeKey({ from: required(fragment[index]), to }),
					),
			);
			expect(absorbed).toHaveLength(7);
		}
		expect(JSON.stringify({ plan: result.plan, organizations: source.organizations })).toBe(before);
	});
	it.each([false, true])("owns only the newly attached orphan with reversed=%s", (reversed) => {
		const placed = placeProductionBays([
			{ x: 0, y: 0 },
			{ x: 100, y: 0 },
			{ x: 200, y: 0 },
		]);
		const bays = placed.organizations.records.filter((record) => record.kind === "BAY");
		const first = firstValidConnector(placed, required(bays[0]).id, required(bays[1]).id);
		const source = { ...required(first.prospectiveState), patchSequence: placed.patchSequence + 1 };
		const pair = reversed
			? [required(bays[2]).id, required(bays[0]).id]
			: [required(bays[0]).id, required(bays[2]).id];
		const result = firstValidConnector(source, required(pair[0]), required(pair[1]));
		const descriptor = describeStaticFabAssemblyConnectorRelationship(
			source.organizations,
			result,
			2,
		);
		expect(descriptor.record.participantOrganizationIds).toEqual(pair);
		expect(descriptor.record.managedChildOrganizationIds).toEqual([required(bays[2]).id]);
	});

	it("preserves lower Bay links, upper Fab link and circulation as one valid dependency state", async () => {
		const placed = placeProductionBays([
			{ x: 0, y: 0 },
			{ x: 100, y: 0 },
			{ x: 300, y: 0 },
			{ x: 400, y: 0 },
		]);
		const bays = placed.organizations.records.filter((record) => record.kind === "BAY");
		const left = firstValidConnector(placed, required(bays[0]).id, required(bays[1]).id);
		const leftRecord = describeStaticFabAssemblyConnectorRelationship(
			placed.organizations,
			left,
			1,
		).record;
		const middle = { ...required(left.prospectiveState), patchSequence: placed.patchSequence + 1 };
		const right = firstValidConnector(middle, required(bays[2]).id, required(bays[3]).id);
		const rightRecord = describeStaticFabAssemblyConnectorRelationship(
			middle.organizations,
			right,
			2,
		).record;
		const source = { ...required(right.prospectiveState), patchSequence: middle.patchSequence + 1 };
		const banks = [leftRecord.parentOrganizationId, rightRecord.parentOrganizationId];
		const joined = firstValidConnector(source, required(banks[0]), required(banks[1]));
		const joinedRecord = describeStaticFabAssemblyConnectorRelationship(
			source.organizations,
			joined,
			3,
		).record;
		expect(joinedRecord.managedChildOrganizationIds).toEqual(banks);
		const records = [leftRecord, rightRecord, joinedRecord];
		expect(
			staticFabAssemblyRelationshipStateSourceError(
				required(joined.prospectiveState).map,
				required(joined.prospectiveState).organizations,
				{ nextRelationshipId: 4, records },
			),
		).toBeNull();
		const fab = { ...required(joined.prospectiveState), patchSequence: source.patchSequence + 1 };
		const loop = firstValidConnector(fab, required(banks[0]), required(banks[1]));
		const loopRecord = describeStaticFabAssemblyConnectorRelationship(
			fab.organizations,
			loop,
			4,
		).record;
		expect(loopRecord.purpose).toBe("FAB_LOOP");
		expect(loopRecord.managedChildOrganizationIds).toEqual([]);
		expect(
			staticFabAssemblyRelationshipStateSourceError(
				required(loop.prospectiveState).map,
				required(loop.prospectiveState).organizations,
				{ nextRelationshipId: 5, records: [...records, loopRecord] },
			),
		).toBeNull();
		let checkpoints = 0;
		const final = required(loop.prospectiveState);
		const canonical = copyStaticFabAssemblyRelationshipState({
			nextRelationshipId: 5,
			records: [...records, loopRecord],
		});
		await verifyNestedRelationshipRemapping(final, canonical);
		verifyRelationshipRemapFailures(leftRecord, final.organizations);
		const proof = await validateStaticFabAssemblyRelationshipSourceActivation(
			final.map,
			final.portEquipment,
			final.organizations,
			canonical,
			async () => {
				checkpoints++;
			},
			32,
		);
		expect(proof.relationshipActivation).toBeDefined();
		expect(checkpoints).toBeGreaterThan(50);

		const document = RailDocument.fromLoadedMap(
			final.map.clone(),
			0,
			final.portEquipment,
			final.organizations,
			undefined,
			canonical,
		);
		const snapshot = () =>
			captureRailMirrorSnapshot(
				document.map,
				document.getPatchSequence(),
				document.portEquipment,
				document.organizations,
				document.relationships,
			).snapshot;
		const project = captureOpenFabProject(document, {
			manifest: createOpenFabProjectManifest(
				"nested-connectors",
				"Nested Connector durability",
				"2026-09-07T00:00:00.000Z",
			),
		});
		const parsed = parseOpenFabProjectJson(serializeOpenFabProject(project));
		const reopened = createRailSnapshotFromOpenFabProject(parsed.project);
		expect(hydrateStaticFabAssemblyRelationshipSnapshot(reopened.relationships)).toEqual(canonical);
		expect(reopened.checksum).toBe(snapshot().checksum);
		const mirror = new RailPatchMirror();
		expect(mirror.sync(reopened).assemblyRelationships).toBe(4);
		const events: RailPatchEvent[] = [];
		document.subscribe((event) => events.push(event));
		for (const [command, expectedCount] of [
			[() => document.clear(), 0],
			[() => document.undo(), 4],
			[() => document.redo(), 0],
		] as const) {
			const previousEvents = events.length;
			expect(command()).toBe(true);
			expect(events.length).toBe(previousEvents + 1);
			const state = mirror.applyPatch(required(events.at(-1)));
			expect(state.assemblyRelationships).toBe(expectedCount);
			expect(state.assemblyRelationshipNextId).toBe(5);
			expect(state.checksum).toBe(snapshot().checksum);
			if (expectedCount === 4) expect(document.relationships).toEqual(canonical);
		}

		// Identity dependencies cannot authorize deleting the lower connection beneath an upper one.
		const lowerCutKeys = new Set(
			[leftRecord, rightRecord].flatMap((record) =>
				record.connectionGroups.flatMap((group) =>
					group.legs.flatMap((leg) =>
						leg.exclusiveCutEdges.map(({ edge }) => staticFabOrganizationEdgeKey(edge)),
					),
				),
			),
		);
		const witnessedCut = required(
			joinedRecord.connectionGroups
				.flatMap((group) => group.legs.flatMap((leg) => leg.endpointSupports))
				.find(({ support }) => lowerCutKeys.has(staticFabOrganizationEdgeKey(support.edge))),
		);
		const erasedMap = final.map.clone();
		const ownership = buildRailModuleOwnershipIndex(erasedMap);
		const witnessedKey = staticFabOrganizationEdgeKey(witnessedCut.support.edge);
		const module = required(
			ownership.modules.find((candidate) =>
				candidate.eraseEdges.some((edge) => staticFabOrganizationEdgeKey(edge) === witnessedKey),
			),
		);
		const erase = planRailModuleBulldoze(erasedMap, module);
		expect(erase.valid).toBe(true);
		expect(erasedMap.applyAtomicMutations(erase.mutations, erase.switchMutations ?? [])).toBe(true);
		const removedKeys = new Set(module.eraseEdges.map(staticFabOrganizationEdgeKey));
		const retainedOrganizations = {
			...final.organizations,
			records: final.organizations.records.map((record) =>
				copyStaticFabOrganizationRecord({
					...record,
					membership: {
						...record.membership,
						railEdges: record.membership.railEdges.filter(
							(edge) => !removedKeys.has(staticFabOrganizationEdgeKey(edge)),
						),
					},
				}),
			),
		};
		expect(staticFabOrganizationRailStateError(erasedMap, retainedOrganizations)).toBeNull();
		expect(
			staticFabAssemblyRelationshipStateSourceError(erasedMap, retainedOrganizations, {
				nextRelationshipId: 5,
				records: [joinedRecord],
			}),
		).toContain(`scoped edge ${witnessedKey}을 현재 Rail에서 찾을 수 없습니다`);
	});
	it("rejects unavailable IDs, stale organization cursors and forged path order without mutation", () => {
		const source = placeProductionBays([
			{ x: 0, y: 0 },
			{ x: 100, y: 0 },
		]);
		const bays = source.organizations.records.filter((record) => record.kind === "BAY");
		const result = firstValidConnector(source, required(bays[0]).id, required(bays[1]).id);
		const before = JSON.stringify({ organizations: source.organizations, plan: result.plan });
		for (const id of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2_147_483_647])
			expect(() =>
				describeStaticFabAssemblyConnectorRelationship(source.organizations, result, id),
			).toThrow(/ID/);
		expect(() =>
			describeStaticFabAssemblyConnectorRelationship(
				{
					...source.organizations,
					nextOrganizationId: source.organizations.nextOrganizationId + 1,
				},
				result,
				1,
			),
		).toThrow(/generation/);
		const forged = {
			...result,
			plan: {
				...result.plan,
				networkLink: {
					...result.plan.networkLink,
					outboundCells: [...result.plan.networkLink.outboundCells].reverse(),
				},
			},
		};
		expect(() =>
			describeStaticFabAssemblyConnectorRelationship(source.organizations, forged, 1),
		).toThrow();
		const invalid = { ...result, plan: { ...result.plan, valid: false } };
		expect(() =>
			describeStaticFabAssemblyConnectorRelationship(source.organizations, invalid, 1),
		).toThrow(/유효한/);
		expect(JSON.stringify({ organizations: source.organizations, plan: result.plan })).toBe(before);
	});
});

function placeProductionBays(anchors: readonly Readonly<{ x: number; y: number }>[]): FixtureState {
	const artifact = certifyProductionBayModuleCatalogRequest(
		defaultProductionBayModuleCatalogRequest("single-production-bay"),
	);
	let fixture: FixtureState = {
		map: new TileMap(),
		portEquipment: emptyPortEquipmentState(),
		organizations: emptyStaticFabOrganizationState(),
		patchSequence: 0,
	};
	for (const anchor of anchors) {
		const placement = planStaticFabOrganizationBundlePlacementWithProspectiveState(
			fixture.map,
			fixture.portEquipment,
			fixture.patchSequence,
			fixture.organizations,
			artifact.organizationBundle,
			anchor,
			0,
			null,
		);
		if (!placement.plan.valid || !placement.prospectiveState) {
			throw new Error(placement.plan.reason);
		}
		fixture = {
			...placement.prospectiveState,
			patchSequence: fixture.patchSequence + 1,
		};
	}
	return fixture;
}

function firstValidConnector(
	fixture: FixtureState,
	sourceOrganizationId: number,
	targetOrganizationId: number,
): StaticFabAssemblyConnectorPlanningResult {
	const roles = deriveStaticFabOrganizationSemanticRoles(fixture.organizations);
	const eligibility =
		roles.get(sourceOrganizationId) === "BAY_BANK" && roles.get(targetOrganizationId) === "BAY_BANK"
			? staticFabAssemblyInterbayConnectorHierarchyEligibility(
					fixture.organizations,
					sourceOrganizationId,
					targetOrganizationId,
				)
			: staticFabAssemblyConnectorHierarchyEligibility(
					fixture.organizations,
					sourceOrganizationId,
					targetOrganizationId,
				);
	const purpose = eligibility.valid ? eligibility.purpose : "HIERARCHY_LINK";
	const discoverGateways =
		purpose === "FAB_LOOP"
			? discoverStaticFabOuterCirculationGateways
			: discoverStaticFabAssemblyGateways;
	const sources = discoverGateways(fixture.map, fixture.organizations, sourceOrganizationId);
	const targets = discoverGateways(fixture.map, fixture.organizations, targetOrganizationId);
	let last: StaticFabAssemblyConnectorPlanningResult | null = null;
	const failureReasons = new Set<string>();
	for (const source of sources) {
		for (const target of targets) {
			for (const side of [null, "left", "right"] as const) {
				last = planStaticFabAssemblyConnectorWithProspectiveState(
					fixture.map,
					fixture.portEquipment,
					fixture.patchSequence,
					fixture.organizations,
					{
						version: STATIC_FAB_ASSEMBLY_CONNECTOR_VERSION,
						purpose,
						sourceOrganizationId,
						sourceGatewayId: source.id,
						sourceAnchor: source.anchor,
						targetOrganizationId,
						targetGatewayId: target.id,
						targetAnchor: target.anchor,
						side,
					},
				);
				if (last.plan.valid) return last;
				failureReasons.add(last.plan.reason);
			}
		}
	}
	throw new Error(
		failureReasons.size > 0
			? [...failureReasons].join(" | ")
			: (last?.plan.reason ?? "No Assembly Connector gateway pair was found."),
	);
}

function required<T>(value: T | null | undefined): T {
	if (value === null || value === undefined) throw new Error("Expected complete Connector fixture");
	return value;
}

async function verifyNestedRelationshipRemapping(
	source: StaticFabOrganizationBundlePlacementProspectiveState,
	relationships: StaticFabAssemblyRelationshipStateV1,
): Promise<void> {
	const before = JSON.stringify({ organizations: source.organizations, relationships });
	const organizationIds = new Map(
		source.organizations.records.map((record) => [record.id, 1000 - record.id]),
	);
	const inverseIds = new Map([...organizationIds].map(([from, to]) => [to, from]));
	const offset = { x: -500, y: 700 };
	for (const quarterTurns of [0, 1, 2, 3] as const) {
		// Independent four-case affine oracle, not the remapper's iterative transform.
		const rotate = ({ x, y }: Cell): Cell =>
			quarterTurns === 0
				? { x, y }
				: quarterTurns === 1
					? { x: -y, y: x }
					: quarterTurns === 2
						? { x: -x, y: -y }
						: { x: y, y: -x };
		const transform = (cell: Cell): Cell => {
			const r = rotate(cell);
			return { x: r.x + offset.x, y: r.y + offset.y };
		};
		const map = new TileMap();
		const rotateMask = (mask: number) =>
			((mask << quarterTurns) | (mask >> (4 - quarterTurns))) & 15;
		expect(source.map.advancedSwitchCount).toBe(0);
		source.map.forEachRail((x, y, rail) => {
			const target = transform({ x, y });
			map.setEncoded(
				target.x,
				target.y,
				encodeRailCell({
					incoming: rotateMask(rail.incoming),
					outgoing: rotateMask(rail.outgoing),
				}),
			);
		});
		const organizations = copyStaticFabOrganizationState({
			nextOrganizationId: 1001,
			records: source.organizations.records
				.map((record) =>
					copyStaticFabOrganizationRecord({
						...record,
						id: required(organizationIds.get(record.id)),
						parentOrganizationIds: staticFabOrganizationParentIds(record)
							.map((id) => required(organizationIds.get(id)))
							.sort((a, b) => a - b),
						membership: {
							...record.membership,
							railEdges: record.membership.railEdges
								.map((edge) => ({ from: transform(edge.from), to: transform(edge.to) }))
								.sort(compareDirectedRailEdges),
						},
					}),
				)
				.sort((a, b) => a.id - b.id),
		});
		const remapped = copyStaticFabAssemblyRelationshipState({
			nextRelationshipId: 21,
			records: relationships.records
				.map((record) =>
					remapStaticFabAssemblyRelationshipRecord(record, {
						relationshipId: 20 - record.id,
						organizationIds,
						quarterTurns,
						offset,
					}),
				)
				.sort((a, b) => a.id - b.id),
		});
		expect(staticFabOrganizationRailStateError(map, organizations)).toBeNull();
		expect(staticFabAssemblyRelationshipStateSourceError(map, organizations, remapped)).toBeNull();
		let checkpoints = 0;
		await validateStaticFabAssemblyRelationshipSourceActivation(
			map,
			source.portEquipment,
			organizations,
			remapped,
			async () => {
				checkpoints++;
			},
			32,
		);
		expect(checkpoints).toBeGreaterThan(50);
		const transformedDocument = RailDocument.fromLoadedMap(
			map.clone(),
			0,
			source.portEquipment,
			organizations,
			undefined,
			remapped,
		);
		const transformedProject = captureOpenFabProject(transformedDocument, {
			manifest: createOpenFabProjectManifest(
				`remapped-${quarterTurns}`,
				"Remapped nested assembly",
				"2026-09-07T00:00:00.000Z",
			),
		});
		const reopened = createRailSnapshotFromOpenFabProject(
			parseOpenFabProjectJson(serializeOpenFabProject(transformedProject)).project,
		);
		expect(hydrateStaticFabAssemblyRelationshipSnapshot(reopened.relationships)).toEqual(remapped);
		const mirror = new RailPatchMirror();
		const mirrored = mirror.sync(reopened);
		expect(mirrored.assemblyRelationships).toBe(4);
		expect(mirrored.checksum).toBe(reopened.checksum);
		const inverseTurns = ((4 - quarterTurns) % 4) as 0 | 1 | 2 | 3;
		const inverseOffset =
			quarterTurns === 0
				? { x: -offset.x, y: -offset.y }
				: quarterTurns === 1
					? { x: -offset.y, y: offset.x }
					: quarterTurns === 2
						? offset
						: { x: offset.y, y: -offset.x };
		const restored = copyStaticFabAssemblyRelationshipState({
			nextRelationshipId: relationships.nextRelationshipId,
			records: remapped.records
				.map((record) =>
					remapStaticFabAssemblyRelationshipRecord(record, {
						relationshipId: 20 - record.id,
						organizationIds: inverseIds,
						quarterTurns: inverseTurns,
						offset: inverseOffset,
					}),
				)
				.sort((a, b) => a.id - b.id),
		});
		expect(restored).toEqual(relationships);
		for (const original of relationships.records) {
			const transformed = required(
				remapped.records.find((record) => record.id === 20 - original.id),
			);
			expect(transformed.participantOrganizationIds).toEqual(
				original.participantOrganizationIds.map((id) => organizationIds.get(id)),
			);
			expect(Object.isFrozen(transformed)).toBe(true);
			expect(
				transformed.connectionGroups.map((group) => group.legs.map((leg) => leg.directionRole)),
			).toEqual(
				original.connectionGroups.map((group) => group.legs.map((leg) => leg.directionRole)),
			);
		}
	}
	expect(JSON.stringify({ organizations: source.organizations, relationships })).toBe(before);
}

function verifyRelationshipRemapFailures(
	record: StaticFabAssemblyRelationshipRecordV1,
	organizations: StaticFabOrganizationState,
): void {
	const organizationIds = new Map(organizations.records.map((item) => [item.id, item.id + 100]));
	const input = {
		relationshipId: 11,
		organizationIds,
		quarterTurns: 0 as const,
		offset: { x: 0, y: 0 },
	};
	for (const relationshipId of [0, -1, 1.5, 2_147_483_647, Number.NaN, Number.POSITIVE_INFINITY]) {
		expect(() =>
			remapStaticFabAssemblyRelationshipRecord(record, { ...input, relationshipId }),
		).toThrow(/ID/);
		expect(() =>
			remapStaticFabAssemblyRelationshipRecord(
				Object.freeze({ ...record, id: relationshipId }),
				input,
			),
		).toThrow(/원본 ID/);
	}
	for (const quarterTurns of [-1, 0.5, 4, Number.NaN]) {
		expect(() =>
			remapStaticFabAssemblyRelationshipRecord(record, {
				...input,
				quarterTurns: quarterTurns as 0,
			}),
		).toThrow(/90도/);
	}
	for (const offset of [
		{ x: 0.5, y: 0 },
		{ x: 0, y: Number.NaN },
		{ x: 2_147_483_648, y: 0 },
	]) {
		expect(() => remapStaticFabAssemblyRelationshipRecord(record, { ...input, offset })).toThrow(
			/정수 셀/,
		);
	}
	const missing = new Map(organizationIds);
	missing.delete(record.parentOrganizationId);
	expect(() =>
		remapStaticFabAssemblyRelationshipRecord(record, { ...input, organizationIds: missing }),
	).toThrow(/새 ID가 없습니다/);
	const collisions = new Map(organizationIds);
	collisions.set(
		required(record.participantOrganizationIds[0]),
		required(organizationIds.get(record.parentOrganizationId)),
	);
	expect(() =>
		remapStaticFabAssemblyRelationshipRecord(record, { ...input, organizationIds: collisions }),
	).toThrow(/같은 ID로 합칠/);
	expect(() =>
		remapStaticFabAssemblyRelationshipRecord(record, {
			...input,
			offset: { x: 2_147_483_647, y: 0 },
		}),
	).toThrow(/좌표/);
	expect(() => remapStaticFabAssemblyRelationshipRecord({ ...record }, input)).toThrow(/불변/);
	const before = JSON.stringify(record);
	expect(() =>
		remapStaticFabAssemblyRelationshipRecord(record, { ...input, organizationIds: new Map() }),
	).toThrow();
	expect(JSON.stringify(record)).toBe(before);
}
