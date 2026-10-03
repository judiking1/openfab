import {
	certifyProductionBayModuleCatalogRequest,
	defaultProductionBayModuleCatalogRequest,
} from "../compile/ProductionBayModuleCatalog";
import { emptyPortEquipmentState, type PortEquipmentState } from "./EquipmentGroup";
import {
	emptyStaticFabAssemblyRelationshipState,
	type StaticFabAssemblyRelationshipStateV1,
} from "./StaticFabAssemblyRelationship";
import {
	compareDirectedRailEdges,
	copyStaticFabOrganizationState,
	emptyStaticFabOrganizationState,
	type StaticFabOrganizationRecord,
	type StaticFabOrganizationState,
} from "./StaticFabOrganization";
import { planStaticFabOrganizationBundlePlacementWithProspectiveState } from "./StaticFabOrganizationBundlePlacement";
import { type Cell, TileMap } from "./TileMap";

export interface LaunchFixture {
	readonly map: TileMap;
	readonly organizations: StaticFabOrganizationState;
	readonly portEquipment: PortEquipmentState;
	readonly relationships: StaticFabAssemblyRelationshipStateV1;
	readonly patchSequence: number;
}

/**
 * Synthetic placement fixture copied from the ordinary connector tests. It uses only the
 * repository's generic single-bay catalog and contains no customer/site data.
 */
export function placeProductionBays(anchors: readonly Readonly<Cell>[]): LaunchFixture {
	const artifact = certifyProductionBayModuleCatalogRequest(
		defaultProductionBayModuleCatalogRequest("single-production-bay"),
	);
	let fixture: LaunchFixture = {
		relationships: emptyStaticFabAssemblyRelationshipState(),
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
			fixture.relationships,
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

function syntheticRecord(
	id: number,
	kind: StaticFabOrganizationRecord["kind"],
	parents: readonly number[] = [],
): StaticFabOrganizationRecord {
	return {
		id,
		kind,
		name: `synthetic ${id}`,
		parentOrganizationIds: parents,
		declaredSemanticRole: null,
		membership: {
			railEdges: [{ from: { x: id * 2, y: 0 }, to: { x: id * 2 + 1, y: 0 } }],
			advancedSwitchIds: [],
			equipmentGroupIds: [],
		},
	};
}

function bayChildWithDirectedRun(
	id: number,
	parentId: number,
	y: number,
): StaticFabOrganizationRecord {
	const base = syntheticRecord(id, "BAY", [parentId]);
	const railEdges: Array<StaticFabOrganizationRecord["membership"]["railEdges"][number]> = [];
	for (let x = 0; x < 16; x++) {
		railEdges.push({ from: { x, y }, to: { x: x + 1, y } });
	}
	return { ...base, membership: { ...base.membership, railEdges } };
}

function canonicalState(
	records: readonly StaticFabOrganizationRecord[],
): StaticFabOrganizationState {
	let maximumId = 0;
	for (const record of records) maximumId = Math.max(maximumId, record.id);
	return copyStaticFabOrganizationState({
		nextOrganizationId: maximumId + 1,
		records: [...records].sort((left, right) => left.id - right.id),
	});
}

function putRailCells(map: TileMap, records: readonly StaticFabOrganizationRecord[]): void {
	for (const record of records) {
		for (const edge of record.membership.railEdges) {
			map.setEncoded(edge.from.x, edge.from.y, 0x11);
			map.setEncoded(edge.to.x, edge.to.y, 0x11);
		}
	}
}

/** Two detached Bay Banks under one Fab; each child Bay owns a 16 m directed run. */
export function sameFabBankFixture(): LaunchFixture {
	const records = [
		syntheticRecord(1, "AREA", [20]),
		bayChildWithDirectedRun(2, 1, 0),
		syntheticRecord(3, "AISLE", [2]),
		syntheticRecord(10, "AREA", [20]),
		bayChildWithDirectedRun(11, 10, 40),
		syntheticRecord(12, "AISLE", [11]),
		syntheticRecord(20, "AREA"),
	];
	const organizations = canonicalState(records);
	const map = new TileMap();
	putRailCells(map, records);
	return {
		map,
		organizations,
		portEquipment: emptyPortEquipmentState(),
		relationships: emptyStaticFabAssemblyRelationshipState(),
		patchSequence: 0,
	};
}

/** Two real Bay records with 100 candidate lanes each for cap/anchor/step coverage. */
export function cappedGatewayFixture(): LaunchFixture {
	const records: StaticFabOrganizationRecord[] = [];
	for (const [bayId, yOffset] of [
		[1, 0],
		[2, 200],
	] as const) {
		const edges: Array<StaticFabOrganizationRecord["membership"]["railEdges"][number]> = [];
		for (let lane = 0; lane < 100; lane++) {
			for (let x = 0; x < 12; x++) {
				edges.push({ from: { x, y: yOffset + lane }, to: { x: x + 1, y: yOffset + lane } });
			}
		}
		edges.sort(compareDirectedRailEdges);
		const base = syntheticRecord(bayId, "BAY");
		records.push({ ...base, membership: { ...base.membership, railEdges: edges } });
		records.push(syntheticRecord(bayId + 2, "AISLE", [bayId]));
	}
	const organizations = canonicalState(records);
	const map = new TileMap();
	putRailCells(map, records);
	// Remove one midpoint anchor from the first owner: that 12 m run must be filtered.
	map.setEncoded(6, 0, 0);
	return {
		map,
		organizations,
		portEquipment: emptyPortEquipmentState(),
		relationships: emptyStaticFabAssemblyRelationshipState(),
		patchSequence: 0,
	};
}

/** Large metadata source used only to prove the launch task's first scheduler turn is bounded. */
export function largeLaunchFixture(targetRecordCount = 100_000): LaunchFixture {
	const fixture = placeProductionBays([
		{ x: 0, y: 0 },
		{ x: 100, y: 0 },
	]);
	const baseRecords = fixture.organizations.records;
	if (!Number.isSafeInteger(targetRecordCount) || targetRecordCount < baseRecords.length) {
		throw new Error("targetRecordCount must cover the base placement records");
	}
	const highest = fixture.organizations.nextOrganizationId - 1;
	const filler: StaticFabOrganizationRecord[] = [];
	for (let index = 0; index < targetRecordCount - baseRecords.length; index++) {
		filler.push(syntheticRecord(highest + index + 1, "AREA"));
	}
	const organizations = canonicalState([...baseRecords, ...filler]);
	if (organizations.records.length !== targetRecordCount) {
		throw new Error("largeLaunchFixture did not reach targetRecordCount");
	}
	return { ...fixture, organizations };
}
