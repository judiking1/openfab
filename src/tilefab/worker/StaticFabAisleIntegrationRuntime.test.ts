import { describe, expect, it } from "vitest";
import { analyzePhysicalPathTopology } from "../compile/PhysicalPathTopology";
import { compilePhysicalRail } from "../compile/PhysicalRailCompiler";
import { deriveAdvancedSwitchGeometry } from "../core/AdvancedSwitch";
import type { RailPatchEvent } from "../core/RailDocument";
import {
	planStaticFabAisleIntegration,
	staticFabAisleIntegrationComponentMap,
	staticFabAisleIntegrationSourceError,
} from "../core/StaticFabAisleIntegration";
import {
	adoptStaticFabAisleIntegrationPlan,
	issueStaticFabAisleIntegrationPermit,
	staticFabAisleIntegrationIdentity,
	staticFabAisleIntegrationIntentFingerprint,
} from "../core/StaticFabAisleIntegrationCertification";
import { copyStaticFabOrganizationRecord } from "../core/StaticFabOrganization";
import { TileMap } from "../core/TileMap";
import { captureOpenFabProject } from "../project/OpenFabProject";
import { parseOpenFabProjectJson, serializeOpenFabProject } from "../project/OpenFabProjectCodec";
import { captureRailMirrorSnapshot, checksumRailMap } from "./RailMirrorChecksum";
import { RailPatchMirror } from "./RailPatchMirror";
import { decodeRailPatchSoA, encodeRailPatchEvent } from "./railMirrorProtocol";
import {
	discoverStaticFabAisleIntegration,
	prepareStaticFabAisleIntegration,
} from "./StaticFabAisleIntegrationRuntime";
import {
	aisleIntegrationFixture,
	aisleIntegrationSwitchFixture,
} from "./StaticFabAisleIntegrationTestFixture";
import { hydrateStaticFabAssemblyConnectorSession } from "./StaticFabAssemblyConnectorRuntime";

describe("AISLE integration certified transaction", () => {
	it.each([
		aisleIntegrationFixture,
		aisleIntegrationSwitchFixture,
	])("joins both legs, preserves the source, and mirrors one commit/Undo/Redo (%#)", (fixture) => {
		const { document, intent, scope } = fixture();
		const capture = captureRailMirrorSnapshot(
			document.map,
			0,
			document.portEquipment,
			document.organizations,
			document.relationships,
		);
		expect(
			staticFabAisleIntegrationIdentity(
				hydrateStaticFabAssemblyConnectorSession(capture.snapshot).source,
				capture.snapshot.checksum,
			),
		).toEqual(staticFabAisleIntegrationIdentity(document, capture.snapshot.checksum));
		const permit = issueStaticFabAisleIntegrationPermit(
			document,
			scope,
			intent,
			capture.snapshot.checksum,
		);
		const result = prepareStaticFabAisleIntegration({
			type: "PREPARE_STATIC_FAB_AISLE_INTEGRATION",
			version: 1,
			requestId: 1,
			ticketId: permit.ticketId,
			snapshot: capture.snapshot,
			intent,
			expectedSource: staticFabAisleIntegrationIdentity(document, capture.snapshot.checksum),
			expectedIntentFingerprint: staticFabAisleIntegrationIntentFingerprint(intent),
		});
		expect(result.valid, result.reason).toBe(true);
		if (!result.plan || !result.ticket) throw new Error(result.reason);
		const plan = adoptStaticFabAisleIntegrationPlan(
			permit,
			result.ticket,
			result.plan,
			document,
			scope,
			intent,
			result.ticket.prospective.checksum,
		);
		const original = document.organizations.records.find(
			(record) => record.id === intent.aisleOrganizationId,
		)!;
		const equipment = document.portEquipment;
		const mirror = new RailPatchMirror();
		mirror.sync(capture.snapshot);
		const events: RailPatchEvent[] = [];
		document.subscribe((event) => events.push(event));
		expect(
			document.commitStaticFabAisleIntegration(plan, scope),
			document.getLastCommandError() ?? "",
		).toBe(true);
		expect(events).toHaveLength(1);
		expect(document.organizations.records.find((record) => record.id === original.id)).toEqual({
			...original,
			parentOrganizationIds: [intent.bayOrganizationId],
		});
		expect(document.portEquipment).toBe(equipment);
		expect(
			mirror.applyPatch(decodeRailPatchSoA(encodeRailPatchEvent(events[0]!).patch)).checksum,
		).toBe(result.ticket.prospective.checksum);
		expect(document.undo()).toBe(true);
		expect(
			mirror.applyPatch(decodeRailPatchSoA(encodeRailPatchEvent(events[1]!).patch)).checksum,
		).toBe(capture.snapshot.checksum);
		expect(document.organizations.records.find((record) => record.id === original.id)).toEqual(
			original,
		);
		expect(document.redo()).toBe(true);
		expect(
			mirror.applyPatch(decodeRailPatchSoA(encodeRailPatchEvent(events[2]!).patch)).checksum,
		).toBe(result.ticket.prospective.checksum);
		expect(
			checksumRailMap(
				document.map,
				document.portEquipment,
				document.organizations,
				document.relationships,
			),
		).toBe(result.ticket.prospective.checksum);
		expect(document.commitStaticFabAisleIntegration(plan, scope)).toBe(false);
		expect(events).toHaveLength(3);
		const project = captureOpenFabProject(document, {
			manifest: {
				id: "synthetic-aisle-test",
				name: "Synthetic integration",
				createdAt: "2026-10-11T00:00:00.000Z",
				updatedAt: "2026-10-11T00:00:00.000Z",
			},
		});
		expect(parseOpenFabProjectJson(serializeOpenFabProject(project)).project).toEqual(project);
		const forged = { ...events[0]!, changes: events[0]!.changes.slice(1) };
		const rejectMirror = new RailPatchMirror();
		rejectMirror.sync(capture.snapshot);
		const beforeMirror = rejectMirror.state;
		expect(() => rejectMirror.applyPatch(forged)).toThrow();
		expect(rejectMirror.state).toEqual(beforeMirror);
	});
});

describe("target Bay advanced-switch physical component", () => {
	it.each([
		true,
		false,
	])("agrees with canonical compilation for a closed return = %s", (closedReturn) => {
		const { document, intent, switchRecord } = aisleIntegrationSwitchFixture(closedReturn);
		const snapshot = captureRailMirrorSnapshot(
			document.map,
			0,
			document.portEquipment,
			document.organizations,
			document.relationships,
		).snapshot;
		// Independently project the canonical Bay by its fixture bounds, without graph traversal.
		const hydrator = TileMap.createHydrator();
		document.map.forEachRail((x, y, _rail, encoded) => {
			if (y >= 0) hydrator.addEncodedCell(x, y, encoded);
		});
		document.map.forEachAdvancedSwitch((record) => hydrator.addAdvancedSwitch(record));
		const canonical = hydrator.finish(
			document.map.getRevision(),
			document.map.getAdvancedSwitchIdCursor(),
		);
		const component = staticFabAisleIntegrationComponentMap(document.map, intent.entryGateway);
		expect(component.getAdvancedSwitch(switchRecord.id)).toEqual(switchRecord);
		expect(component.advancedSwitchCount).toBe(1);
		expect(component.getAdvancedSwitchIdCursor()).toBe(document.map.getAdvancedSwitchIdCursor());
		for (const cell of deriveAdvancedSwitchGeometry(switchRecord).claimedCells) {
			expect(component.getEncoded(cell.x, cell.y)).toBe(document.map.getEncoded(cell.x, cell.y));
			expect(component.getAdvancedSwitchOwningCell(cell.x, cell.y)).toEqual(switchRecord);
		}
		const expectedLayout = compilePhysicalRail(canonical);
		const actualLayout = compilePhysicalRail(component);
		expect(actualLayout).toEqual(expectedLayout);
		const topology = analyzePhysicalPathTopology(expectedLayout.paths);
		const canonicalAccepts =
			expectedLayout.valid &&
			expectedLayout.clearance.issues.count === 0 &&
			topology.openPaths === 0 &&
			topology.invalidPaths === 0 &&
			topology.strongComponents === 1;
		expect(canonicalAccepts).toBe(closedReturn);
		const result = prepareStaticFabAisleIntegration({
			type: "PREPARE_STATIC_FAB_AISLE_INTEGRATION",
			version: 1,
			requestId: 1,
			ticketId: 1,
			snapshot,
			intent,
			expectedSource: staticFabAisleIntegrationIdentity(document, snapshot.checksum),
			expectedIntentFingerprint: staticFabAisleIntegrationIntentFingerprint(intent),
		});
		expect(result.valid, result.reason).toBe(canonicalAccepts);
		if (!closedReturn) expect(result.ticket).toBeNull();
		expect(
			checksumRailMap(
				document.map,
				document.portEquipment,
				document.organizations,
				document.relationships,
			),
		).toBe(snapshot.checksum);
		expect(document.getPatchSequence()).toBe(0);
		expect(document.canUndo).toBe(false);
	});
});

describe("AISLE integration rejection boundaries", () => {
	it("finds bounded physical candidates without changing source", () => {
		const { document, intent } = aisleIntegrationFixture();
		const snapshot = captureRailMirrorSnapshot(
			document.map,
			0,
			document.portEquipment,
			document.organizations,
			document.relationships,
		).snapshot;
		const result = discoverStaticFabAisleIntegration({
			type: "DISCOVER_STATIC_FAB_AISLE_INTEGRATION",
			version: 1,
			requestId: 1,
			snapshot,
			aisleOrganizationId: intent.aisleOrganizationId,
			bayOrganizationId: intent.bayOrganizationId,
		});
		expect(result.options.length, result.reason).toBeGreaterThan(0);
		expect(result.options.length).toBeLessThanOrEqual(8);
		expect(
			checksumRailMap(
				document.map,
				document.portEquipment,
				document.organizations,
				document.relationships,
			),
		).toBe(snapshot.checksum);
		expect(document.canUndo).toBe(false);
	});
	it.each([
		"declared",
		"parent",
		"child",
		"shared",
	])("rejects %s source ownership without mutation", (mode) => {
		const { document, intent } = aisleIntegrationFixture();
		const aisle = document.organizations.records.find(
			(record) => record.id === intent.aisleOrganizationId,
		)!;
		const records = [...document.organizations.records];
		if (mode === "declared")
			records[records.length - 1] = copyStaticFabOrganizationRecord({
				...aisle,
				declaredSemanticRole: "PROCESS_LOOP",
			});
		if (mode === "parent")
			records[records.length - 1] = copyStaticFabOrganizationRecord({
				...aisle,
				parentOrganizationIds: [1],
			});
		if (mode === "child" || mode === "shared")
			records.push(
				copyStaticFabOrganizationRecord({
					...aisle,
					id: 100,
					kind: "PROCESS_FAMILY",
					parentOrganizationIds: mode === "child" ? [aisle.id] : [],
				}),
			);
		expect(
			staticFabAisleIntegrationSourceError(
				{ records, nextOrganizationId: 101 },
				document.relationships,
				aisle.id,
			),
		).not.toBeNull();
		expect(document.getPatchSequence()).toBe(0);
		expect(document.canUndo).toBe(false);
	});
	it("rejects a child-owned Bay gateway atomically", () => {
		const { document, intent, scope } = aisleIntegrationFixture();
		const child = document.organizations.records.find((record) => record.id === 2)!;
		const source = checksumRailMap(
			document.map,
			document.portEquipment,
			document.organizations,
			document.relationships,
		);
		const failed = planStaticFabAisleIntegration(document, 0, {
			...intent,
			entryGateway: child.membership.railEdges[0]!.from,
		});
		expect(failed.plan.valid).toBe(false);
		expect(failed.plan.draft.mutations).toHaveLength(0);
		expect(document.commitStaticFabAisleIntegration(failed.plan, scope)).toBe(false);
		expect(
			checksumRailMap(
				document.map,
				document.portEquipment,
				document.organizations,
				document.relationships,
			),
		).toBe(source);
		expect(document.getPatchSequence()).toBe(0);
	});
	it("rejects an assembly-managed source", () => {
		const { document, intent } = aisleIntegrationFixture();
		const relationships = {
			nextRelationshipId: 2,
			records: [
				{
					parentOrganizationId: intent.aisleOrganizationId,
					participantOrganizationIds: [],
					managedChildOrganizationIds: [],
				},
			],
		};
		expect(
			staticFabAisleIntegrationSourceError(
				document.organizations,
				relationships as unknown as typeof document.relationships,
				intent.aisleOrganizationId,
			),
		).toMatch(/조립 관계/);
	});
	it("rejects invalid source ports before any plan can be adopted", () => {
		const { document, intent } = aisleIntegrationFixture();
		const equipment = {
			...document.portEquipment,
			ports: document.portEquipment.ports.map((port) => ({
				...port,
				route: { kind: "CARDINAL_CELL" as const, x: 999, z: 999, from: 8 as const, to: 2 as const },
			})),
		};
		const snapshot = captureRailMirrorSnapshot(
			document.map,
			0,
			equipment,
			document.organizations,
			document.relationships,
		).snapshot;
		const result = prepareStaticFabAisleIntegration({
			type: "PREPARE_STATIC_FAB_AISLE_INTEGRATION",
			version: 1,
			requestId: 1,
			ticketId: 1,
			snapshot,
			intent,
			expectedSource: staticFabAisleIntegrationIdentity(document, snapshot.checksum),
			expectedIntentFingerprint: staticFabAisleIntegrationIntentFingerprint(intent),
		});
		expect(result.valid).toBe(false);
		expect(result.ticket).toBeNull();
		expect(document.canUndo).toBe(false);
	});
});
