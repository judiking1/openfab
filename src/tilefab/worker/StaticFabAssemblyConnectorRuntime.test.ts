import { beforeAll, describe, expect, it } from "vitest";
import { compilePhysicalRail } from "../compile/PhysicalRailCompiler";
import { planOhbPlacement } from "../compile/PortPlacementPlanner";
import {
	compilePortSlots,
	PORT_SLOT_STATUS,
	PortSlotAvailabilityIndex,
} from "../compile/PortSlotCompiler";
import {
	certifyProductionBayModuleCatalogRequest,
	defaultProductionBayModuleCatalogRequest,
} from "../compile/ProductionBayModuleCatalog";
import { emptyPortEquipmentState } from "../core/EquipmentGroup";
import { RailDocument } from "../core/RailDocument";
import {
	discoverStaticFabAssemblyGateways,
	discoverStaticFabOuterCirculationGateways,
	planStaticFabAssemblyConnectorWithProspectiveState,
	STATIC_FAB_ASSEMBLY_CONNECTOR_VERSION,
	type StaticFabAssemblyConnectorIntent,
} from "../core/StaticFabAssemblyConnector";
import {
	staticFabAssemblyConnectorIntentFingerprint,
	staticFabAssemblyConnectorPlanFingerprint,
} from "../core/StaticFabAssemblyConnectorCertification";
import {
	deriveStaticFabOrganizationSemanticRoles,
	emptyStaticFabOrganizationState,
} from "../core/StaticFabOrganization";
import {
	planStaticFabOrganizationBundlePlacementWithProspectiveState,
	type StaticFabOrganizationBundlePlacementProspectiveState,
} from "../core/StaticFabOrganizationBundlePlacement";
import { TileMap } from "../core/TileMap";
import {
	captureRailMirrorSnapshot,
	checksumRailMap,
	checksumRailPatchResult,
	type RailMirrorSnapshot,
} from "./RailMirrorChecksum";
import {
	type PrepareStaticFabAssemblyConnectorRequest,
	STATIC_FAB_ASSEMBLY_CONNECTOR_CONFLICT_LIMIT,
	STATIC_FAB_ASSEMBLY_CONNECTOR_MAX_RESPONSE_TEXT,
	STATIC_FAB_ASSEMBLY_CONNECTOR_PROTOCOL_VERSION,
} from "./StaticFabAssemblyConnectorProtocol";
import { staticFabAssemblyConnectorPreparedShapeError } from "./StaticFabAssemblyConnectorResponseValidator";
import { prepareStaticFabAssemblyConnector } from "./StaticFabAssemblyConnectorRuntime";

interface FixtureState extends StaticFabOrganizationBundlePlacementProspectiveState {
	readonly patchSequence: number;
}

interface ExactFixture extends FixtureState {
	readonly snapshot: RailMirrorSnapshot;
	readonly intent: StaticFabAssemblyConnectorIntent;
}

describe("StaticFabAssemblyConnectorRuntime", () => {
	let fixture: ExactFixture;
	let interbayFixture: ExactFixture;
	let fabLoopFixture: ExactFixture;

	beforeAll(() => {
		fixture = exactFixture();
		interbayFixture = exactInterbayFixture();
		fabLoopFixture = exactFabLoopFixture();
	});

	it("prepares one exact source-bound connector from two public Production Bays", () => {
		let now = 0;
		const request = connectorRequest(fixture, fixture.intent, 71);
		const prepared = prepareStaticFabAssemblyConnector(request, () => ++now);

		expect(staticFabAssemblyConnectorPreparedShapeError(prepared)).toBeNull();
		expect(prepared.valid, prepared.reason).toBe(true);
		expect(prepared).toMatchObject({
			failureCode: null,
			conflictCells: [],
			conflictCount: 0,
			planningMilliseconds: 1,
			validationMilliseconds: 1,
		});
		if (!prepared.plan || !prepared.ticket) throw new Error("Expected one exact connector plan.");
		expect(prepared.plan).toMatchObject({
			valid: true,
			baseRevision: fixture.snapshot.revision,
			basePatchSequence: fixture.snapshot.sequence,
			assemblyConnector: {
				sourceOrganizationId: fixture.intent.sourceOrganizationId,
				sourceGatewayId: fixture.intent.sourceGatewayId,
				targetOrganizationId: fixture.intent.targetOrganizationId,
				targetGatewayId: fixture.intent.targetGatewayId,
				issueCode: null,
			},
		});
		expect(prepared.ticket).toMatchObject({
			ticketId: 71,
			validationLevel: "exact",
			sourceRevision: fixture.snapshot.revision,
			sourcePatchSequence: fixture.snapshot.sequence,
			sourceChecksum: fixture.snapshot.checksum,
			intentFingerprint: request.expectedIntentFingerprint,
			prospectiveNextOrganizationId: prepared.plan.nextOrganizationIdAfter,
		});
		expect(prepared.ticket.planFingerprint).toBe(
			staticFabAssemblyConnectorPlanFingerprint(prepared.plan),
		);
		expect(prepared.ticket.prospectiveChecksum).toBe(
			checksumRailPatchResult(fixture.snapshot.checksum, {
				changes: prepared.plan.mutations,
				switchChanges: prepared.plan.switchMutations ?? [],
				portChanges: [],
				equipmentGroupChanges: [],
				organizationChanges: prepared.plan.organizationMutations,
				organizationNextIdBefore: prepared.plan.nextOrganizationIdBefore,
				organizationNextIdAfter: prepared.plan.nextOrganizationIdAfter,
			}),
		);
		expect(prepared.ticket.prospectiveChecksum).not.toBe(fixture.snapshot.checksum);
		expect(checksumRailMap(fixture.map, fixture.portEquipment, fixture.organizations)).toBe(
			fixture.snapshot.checksum,
		);
	});

	it("prepares one exact Bank-to-Fab Interbay with coherent hierarchy metadata", () => {
		const prepared = prepareStaticFabAssemblyConnector(
			connectorRequest(interbayFixture, interbayFixture.intent, 81),
		);

		expect(staticFabAssemblyConnectorPreparedShapeError(prepared)).toBeNull();
		expect(prepared.valid, prepared.reason).toBe(true);
		expect(prepared.plan?.assemblyConnector).toMatchObject({
			hierarchyRole: "BANK_TO_FAB",
			bankOrganizationId: null,
			createdBank: false,
			createdFab: true,
			issueCode: null,
		});
		expect(prepared.plan?.assemblyConnector.fabOrganizationId).toBeGreaterThan(0);
		expect(prepared.ticket?.prospectiveNextOrganizationId).toBe(
			prepared.plan?.nextOrganizationIdAfter,
		);
	});

	it("prepares one exact same-Fab outer circulation route without creating hierarchy", () => {
		const prepared = prepareStaticFabAssemblyConnector(
			connectorRequest(fabLoopFixture, fabLoopFixture.intent, 83),
		);

		expect(staticFabAssemblyConnectorPreparedShapeError(prepared)).toBeNull();
		expect(prepared.valid, prepared.reason).toBe(true);
		expect(prepared.plan?.assemblyConnector).toMatchObject({
			hierarchyRole: "BANK_TO_FAB",
			purpose: "FAB_LOOP",
			createdBank: false,
			createdFab: false,
			issueCode: null,
		});
		expect(prepared.plan?.nextOrganizationIdAfter).toBe(prepared.plan?.nextOrganizationIdBefore);
	});

	it("rejects contradictory Bank and Fab hierarchy metadata at the Worker boundary", () => {
		const prepared = prepareStaticFabAssemblyConnector(
			connectorRequest(interbayFixture, interbayFixture.intent, 82),
		);
		if (!prepared.plan) throw new Error("Expected one exact Interbay plan.");
		const contradictory = {
			...prepared,
			plan: {
				...prepared.plan,
				assemblyConnector: {
					...prepared.plan.assemblyConnector,
					bankOrganizationId: prepared.plan.assemblyConnector.fabOrganizationId,
					createdBank: true,
				},
			},
		};

		expect(staticFabAssemblyConnectorPreparedShapeError(contradictory)).toBe(
			"connector metadata is malformed",
		);
	});

	it("rejects malformed intent before planning and a forged valid intent fingerprint", () => {
		const malformed = {
			...fixture.intent,
			sourceGatewayId: "",
		} as StaticFabAssemblyConnectorIntent;
		const malformedResult = prepareStaticFabAssemblyConnector(
			connectorRequest(fixture, malformed, 72, "not-used"),
		);

		expect(malformedResult).toMatchObject({
			valid: false,
			failureCode: "intent",
			plan: null,
			ticket: null,
		});

		const forged = Object.freeze({
			...fixture.intent,
			side: "left" as const,
		});
		const forgedResult = prepareStaticFabAssemblyConnector(
			connectorRequest(
				fixture,
				forged,
				73,
				staticFabAssemblyConnectorIntentFingerprint(fixture.intent),
			),
		);

		expect(forgedResult).toMatchObject({
			valid: false,
			failureCode: "fingerprint",
			plan: null,
			ticket: null,
		});
		expect(forgedResult.reason).toContain("Worker");
	});

	it("rejects corrupt checksums and invalid stale-generation metadata before planning", () => {
		const request = connectorRequest(fixture, fixture.intent, 74);
		const corruptChecksum = prepareStaticFabAssemblyConnector({
			...request,
			snapshot: { ...request.snapshot, checksum: "00000000" },
		});
		const invalidGeneration = prepareStaticFabAssemblyConnector({
			...request,
			snapshot: { ...request.snapshot, sequence: -1 },
		});

		for (const result of [corruptChecksum, invalidGeneration]) {
			expect(result).toMatchObject({
				valid: false,
				failureCode: "snapshot",
				plan: null,
				ticket: null,
			});
			expect(result.conflictCells).toEqual([]);
		}
		expect(corruptChecksum.reason.toLowerCase()).toContain("checksum");
		expect(invalidGeneration.reason.toLowerCase()).toContain("sequence");
	});

	it("returns a bounded non-committable rejection for a same-Bay connector", () => {
		const sameBayIntent = Object.freeze({
			...fixture.intent,
			targetOrganizationId: fixture.intent.sourceOrganizationId,
			targetGatewayId: fixture.intent.sourceGatewayId,
			targetAnchor: fixture.intent.sourceAnchor,
		});
		const prepared = prepareStaticFabAssemblyConnector(
			connectorRequest(fixture, sameBayIntent, 75),
		);

		expect(staticFabAssemblyConnectorPreparedShapeError(prepared)).toBeNull();
		expect(prepared).toMatchObject({
			valid: false,
			failureCode: "plan",
			ticket: null,
		});
		expect(prepared.reason.length).toBeLessThanOrEqual(
			STATIC_FAB_ASSEMBLY_CONNECTOR_MAX_RESPONSE_TEXT,
		);
		expect(prepared.conflictCells.length).toBeLessThanOrEqual(
			STATIC_FAB_ASSEMBLY_CONNECTOR_CONFLICT_LIMIT,
		);
		expect(prepared.plan?.cells.length).toBeLessThanOrEqual(
			STATIC_FAB_ASSEMBLY_CONNECTOR_CONFLICT_LIMIT,
		);
		expect(prepared.plan?.conflicts.length).toBeLessThanOrEqual(
			STATIC_FAB_ASSEMBLY_CONNECTOR_CONFLICT_LIMIT,
		);
		expect(prepared.plan?.mutations).toEqual([]);
		expect(prepared.plan?.switchMutations).toEqual([]);
		expect(prepared.plan?.organizationMutations).toEqual([]);
		expect(
			new TextEncoder().encode(JSON.stringify(structuredClone(prepared))).byteLength,
		).toBeLessThan(64 * 1024);
	});

	it("does not echo an oversized hostile gateway identifier into its rejection", () => {
		const oversizedIntent = {
			...fixture.intent,
			sourceGatewayId: "x".repeat(64 * 1024),
		} as StaticFabAssemblyConnectorIntent;
		const prepared = prepareStaticFabAssemblyConnector(
			connectorRequest(fixture, oversizedIntent, 76, "forged"),
		);

		expect(prepared).toMatchObject({
			valid: false,
			failureCode: "intent",
			plan: null,
			ticket: null,
		});
		expect(prepared.reason.length).toBeLessThanOrEqual(
			STATIC_FAB_ASSEMBLY_CONNECTOR_MAX_RESPONSE_TEXT,
		);
		expect(new TextEncoder().encode(JSON.stringify(prepared)).byteLength).toBeLessThan(8 * 1024);
	});
});

function exactFixture(): ExactFixture {
	const fixture = placeOneOhb(
		placeProductionBays([
			{ x: 0, y: 0 },
			{ x: 100, y: 0 },
		]),
	);
	const bays = fixture.organizations.records.filter((record) => record.kind === "BAY");
	const sourceOrganizationId = bays[0]?.id;
	const targetOrganizationId = bays[1]?.id;
	if (!sourceOrganizationId || !targetOrganizationId) {
		throw new Error("Expected two public Production Bay organizations.");
	}
	const snapshot = captureRailMirrorSnapshot(
		fixture.map,
		fixture.patchSequence,
		fixture.portEquipment,
		fixture.organizations,
	).snapshot;
	const sources = discoverStaticFabAssemblyGateways(
		fixture.map,
		fixture.organizations,
		sourceOrganizationId,
	);
	const targets = discoverStaticFabAssemblyGateways(
		fixture.map,
		fixture.organizations,
		targetOrganizationId,
	);
	let lastReason = "No gateway pairs were discovered.";
	for (const source of sources) {
		for (const target of targets) {
			const intent = Object.freeze({
				version: STATIC_FAB_ASSEMBLY_CONNECTOR_VERSION,
				purpose: "HIERARCHY_LINK",
				sourceOrganizationId,
				sourceGatewayId: source.id,
				sourceAnchor: source.anchor,
				targetOrganizationId,
				targetGatewayId: target.id,
				targetAnchor: target.anchor,
				side: null,
			}) satisfies StaticFabAssemblyConnectorIntent;
			const planning = planStaticFabAssemblyConnectorWithProspectiveState(
				fixture.map,
				fixture.portEquipment,
				fixture.patchSequence,
				fixture.organizations,
				intent,
			);
			lastReason = planning.plan.reason;
			if (!planning.plan.valid) continue;
			const prepared = prepareStaticFabAssemblyConnector(
				connectorRequest({ ...fixture, snapshot, intent }, intent, 1),
			);
			lastReason = prepared.reason;
			if (prepared.valid) return Object.freeze({ ...fixture, snapshot, intent });
		}
	}
	throw new Error(lastReason);
}

function exactInterbayFixture(): ExactFixture {
	let fixture = placeProductionBays([
		{ x: 0, y: 0 },
		{ x: 100, y: 0 },
		{ x: 300, y: 0 },
		{ x: 400, y: 0 },
	]);
	const bays = fixture.organizations.records.filter((record) => record.kind === "BAY");
	fixture = applyFirstValidPlanning(fixture, bays[0]?.id ?? -1, bays[1]?.id ?? -1);
	fixture = applyFirstValidPlanning(fixture, bays[2]?.id ?? -1, bays[3]?.id ?? -1);
	const roles = deriveStaticFabOrganizationSemanticRoles(fixture.organizations);
	const banks = fixture.organizations.records.filter(
		(record) => roles.get(record.id) === "BAY_BANK",
	);
	if (banks.length !== 2) throw new Error("Expected two detached Bay Banks.");
	return exactConnectorFixture(fixture, banks[0]?.id ?? -1, banks[1]?.id ?? -1);
}

function exactFabLoopFixture(): ExactFixture {
	const interbay = exactInterbayFixture();
	const planning = planStaticFabAssemblyConnectorWithProspectiveState(
		interbay.map,
		interbay.portEquipment,
		interbay.patchSequence,
		interbay.organizations,
		interbay.intent,
	);
	if (!planning.plan.valid || !planning.prospectiveState) throw new Error(planning.plan.reason);
	const fixture = Object.freeze({
		...planning.prospectiveState,
		patchSequence: interbay.patchSequence + 1,
	});
	const roles = deriveStaticFabOrganizationSemanticRoles(fixture.organizations);
	const banks = fixture.organizations.records.filter(
		(record) => roles.get(record.id) === "BAY_BANK",
	);
	if (banks.length !== 2) throw new Error("Expected two Banks below one Fab.");
	return exactConnectorFixture(fixture, banks[0]?.id ?? -1, banks[1]?.id ?? -1, "FAB_LOOP");
}

function applyFirstValidPlanning(
	fixture: FixtureState,
	sourceOrganizationId: number,
	targetOrganizationId: number,
): FixtureState {
	const exact = exactConnectorFixture(fixture, sourceOrganizationId, targetOrganizationId);
	const planning = planStaticFabAssemblyConnectorWithProspectiveState(
		fixture.map,
		fixture.portEquipment,
		fixture.patchSequence,
		fixture.organizations,
		exact.intent,
	);
	if (!planning.plan.valid || !planning.prospectiveState) throw new Error(planning.plan.reason);
	return Object.freeze({
		...planning.prospectiveState,
		patchSequence: fixture.patchSequence + 1,
	});
}

function exactConnectorFixture(
	fixture: FixtureState,
	sourceOrganizationId: number,
	targetOrganizationId: number,
	purpose: StaticFabAssemblyConnectorIntent["purpose"] = "HIERARCHY_LINK",
): ExactFixture {
	const snapshot = captureRailMirrorSnapshot(
		fixture.map,
		fixture.patchSequence,
		fixture.portEquipment,
		fixture.organizations,
	).snapshot;
	const discoverGateways =
		purpose === "FAB_LOOP"
			? discoverStaticFabOuterCirculationGateways
			: discoverStaticFabAssemblyGateways;
	const sources = discoverGateways(fixture.map, fixture.organizations, sourceOrganizationId);
	const targets = discoverGateways(fixture.map, fixture.organizations, targetOrganizationId);
	let lastReason = "No gateway pairs were discovered.";
	for (const source of sources) {
		for (const target of targets) {
			const intent = Object.freeze({
				version: STATIC_FAB_ASSEMBLY_CONNECTOR_VERSION,
				purpose,
				sourceOrganizationId,
				sourceGatewayId: source.id,
				sourceAnchor: source.anchor,
				targetOrganizationId,
				targetGatewayId: target.id,
				targetAnchor: target.anchor,
				side: null,
			}) satisfies StaticFabAssemblyConnectorIntent;
			const planning = planStaticFabAssemblyConnectorWithProspectiveState(
				fixture.map,
				fixture.portEquipment,
				fixture.patchSequence,
				fixture.organizations,
				intent,
			);
			lastReason = planning.plan.reason;
			if (planning.plan.valid) return Object.freeze({ ...fixture, snapshot, intent });
		}
	}
	throw new Error(lastReason);
}

function placeOneOhb(fixture: FixtureState): FixtureState {
	const document = RailDocument.fromLoadedMap(
		fixture.map,
		fixture.patchSequence,
		fixture.portEquipment,
		fixture.organizations,
	);
	const layout = compilePhysicalRail(document.map);
	const slots = compilePortSlots(layout, document.portEquipment, "OHB");
	const availability = new PortSlotAvailabilityIndex(layout, document.portEquipment, "OHB");
	for (let row = 0; row < slots.count; row++) {
		if ((slots.statuses[row] as number) !== PORT_SLOT_STATUS.LEGAL) continue;
		const plan = planOhbPlacement(
			slots,
			row,
			availability,
			document.portEquipment,
			document.map.getRevision(),
			document.getPatchSequence(),
		);
		if (!plan.valid || !document.commitPortEquipment(plan)) continue;
		return Object.freeze({
			map: document.map,
			portEquipment: document.portEquipment,
			organizations: document.organizations,
			patchSequence: document.getPatchSequence(),
		});
	}
	throw new Error("Expected one legal OHB slot in the Production Bay fixture.");
}

function connectorRequest(
	fixture: ExactFixture,
	intent: StaticFabAssemblyConnectorIntent,
	ticketId: number,
	expectedIntentFingerprint = staticFabAssemblyConnectorIntentFingerprint(intent),
): PrepareStaticFabAssemblyConnectorRequest {
	return Object.freeze({
		type: "PREPARE_STATIC_FAB_ASSEMBLY_CONNECTOR" as const,
		version: STATIC_FAB_ASSEMBLY_CONNECTOR_PROTOCOL_VERSION,
		requestId: ticketId,
		ticketId,
		snapshot: fixture.snapshot,
		intent,
		expectedIntentFingerprint,
	});
}

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
