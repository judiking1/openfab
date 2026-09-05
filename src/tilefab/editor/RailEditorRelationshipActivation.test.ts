import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { productionBankContactFixture } from "../compile/StaticFabAssemblyRelationshipTestFixture";
import { RailDocument } from "../core/RailDocument";
import { railModuleOwnershipIndexMatchesMap } from "../core/RailModuleOwnership";
import * as relationshipSource from "../core/StaticFabAssemblyRelationship";
import * as relationshipActivation from "../core/StaticFabAssemblyRelationshipActivation";
import { planRenameStaticFabOrganization } from "../core/StaticFabOrganizationPlan";
import { captureRailMirrorSnapshot } from "../worker/RailMirrorChecksum";
import { compileRailStartup } from "../worker/RailStartupRuntime";
import { activateRailEditorStartup, type RailStartupScheduler } from "./RailEditorStartup";
import { RailStartupCancelledError } from "./RailStartupBridge";

describe("non-empty relationship document activation", () => {
	let fixture: ReturnType<typeof productionBankContactFixture>;
	beforeAll(() => {
		fixture = productionBankContactFixture();
	});
	afterEach(() => vi.restoreAllMocks());

	it("publishes the closed Production 60 Contact generation through real startup without repeating synchronous source validation", async () => {
		const payload = startupPayload();
		const sourceValidation = vi.spyOn(
			relationshipSource,
			"assertStaticFabAssemblyRelationshipStateSource",
		);
		const proofValidation = vi.spyOn(
			relationshipActivation,
			"validateStaticFabAssemblyRelationshipActivation",
		);
		const scheduler = new TestScheduler();
		const activation = await activateRailEditorStartup(payload, scheduler, undefined, 1);
		const { model } = activation;
		expect(model.analysis).toMatchObject({
			cells: 30_488,
			edges: 30_672,
			components: 1,
			strongComponents: 1,
			openEnds: 0,
			unsafeJunctions: 0,
		});
		expect(model.readiness.ready).toBe(true);
		expect(model.relationships).toEqual(fixture.relationships);
		expect(model.document.relationships).toBe(model.relationships);
		expect(model.document.organizations).toBe(model.organizations);
		expect(model.document.getPatchSequence()).toBe(17);
		expect(model.document.canUndo).toBe(false);
		expect(model.document.canRedo).toBe(false);
		expect(railModuleOwnershipIndexMatchesMap(model.ownership, model.map)).toBe(true);
		expect(model.authoredChecksum).toBe(
			captureRailMirrorSnapshot(
				model.map,
				17,
				model.portEquipment,
				model.organizations,
				model.relationships,
			).snapshot.checksum,
		);
		expect(proofValidation).toHaveBeenCalledOnce();
		expect(sourceValidation).toHaveBeenCalledOnce();
		expect(scheduler.yields).toBeGreaterThan(0);
	});

	it("binds relationship evidence to the exact existing publication document", async () => {
		const document = RailDocument.fromLoadedMap(
			fixture.map.clone(),
			17,
			fixture.portEquipment,
			fixture.organizations,
			undefined,
			fixture.relationships,
		);
		const payload = compileRailStartup({
			kind: "snapshot",
			snapshot: captureRailMirrorSnapshot(
				document.map,
				17,
				document.portEquipment,
				document.organizations,
				document.relationships,
			).snapshot,
		});
		const proofValidation = vi.spyOn(
			relationshipActivation,
			"validateStaticFabAssemblyRelationshipActivation",
		);
		const activation = await activateRailEditorStartup(
			payload,
			new TestScheduler(),
			undefined,
			1,
			document,
		);
		expect(activation.model.document).toBe(document);
		expect(activation.model.relationships).toBe(document.relationships);
		expect(proofValidation).toHaveBeenCalledOnce();
		const [map, ports, organizations, relationships] = proofValidation.mock.calls[0] ?? [];
		expect(map).toBe(document.map);
		expect(ports).toBe(document.portEquipment);
		expect(organizations).toBe(document.organizations);
		expect(relationships).toBe(document.relationships);
		expect(railModuleOwnershipIndexMatchesMap(activation.model.ownership, document.map)).toBe(true);
		expect(document.canUndo).toBe(false);
	});

	it("honors cancellation after relationship proof completion before document publication", async () => {
		const payload = startupPayload();
		const controller = new AbortController();
		const original = relationshipActivation.validateStaticFabAssemblyRelationshipActivation;
		vi.spyOn(
			relationshipActivation,
			"validateStaticFabAssemblyRelationshipActivation",
		).mockImplementation(async (...args) => {
			const proof = await original(...args);
			controller.abort();
			return proof;
		});
		const publication = vi.spyOn(RailDocument, "fromCooperativelyValidatedMap");
		await expect(
			activateRailEditorStartup(payload, new TestScheduler(), controller.signal, 1),
		).rejects.toBeInstanceOf(RailStartupCancelledError);
		expect(publication).not.toHaveBeenCalled();
	});

	it("rejects a publication document edited after proof completion while preserving the user's edit", async () => {
		const document = RailDocument.fromLoadedMap(
			fixture.map.clone(),
			17,
			fixture.portEquipment,
			fixture.organizations,
			undefined,
			fixture.relationships,
		);
		const payload = compileRailStartup({
			kind: "snapshot",
			snapshot: captureRailMirrorSnapshot(
				document.map,
				17,
				document.portEquipment,
				document.organizations,
				document.relationships,
			).snapshot,
		});
		const organizationId = document.organizations.records[0]?.id;
		if (organizationId === undefined) throw new Error("Missing production organization");
		const rename = planRenameStaticFabOrganization(
			document.map,
			document.portEquipment,
			document.getPatchSequence(),
			document.organizations,
			organizationId,
			"Renamed during activation",
		);
		expect(rename.valid).toBe(true);
		const original = relationshipActivation.validateStaticFabAssemblyRelationshipActivation;
		vi.spyOn(
			relationshipActivation,
			"validateStaticFabAssemblyRelationshipActivation",
		).mockImplementation(async (...args) => {
			const proof = await original(...args);
			expect(document.commitOrganization(rename)).toBe(true);
			return proof;
		});
		await expect(
			activateRailEditorStartup(payload, new TestScheduler(), undefined, 1, document),
		).rejects.toThrow(/publication document changed/);
		expect(document.organizations.records[0]?.name).toBe("Renamed during activation");
		expect(document.getPatchSequence()).toBe(18);
		expect(document.canUndo).toBe(true);
	});

	it("rejects a late map edit/rollback even when revision, sequence, and contents return to their original values", async () => {
		const document = RailDocument.fromLoadedMap(
			fixture.map.clone(),
			17,
			fixture.portEquipment,
			fixture.organizations,
			undefined,
			fixture.relationships,
		);
		const payload = compileRailStartup({
			kind: "snapshot",
			snapshot: captureRailMirrorSnapshot(
				document.map,
				17,
				document.portEquipment,
				document.organizations,
				document.relationships,
			).snapshot,
		});
		const x = payload.snapshot.xs[0] as number;
		const y = payload.snapshot.ys[0] as number;
		const before = document.map.getEncoded(x, y);
		const revision = document.map.getRevision();
		const original = relationshipActivation.validateStaticFabAssemblyRelationshipActivation;
		vi.spyOn(
			relationshipActivation,
			"validateStaticFabAssemblyRelationshipActivation",
		).mockImplementation(async (...args) => {
			const proof = await original(...args);
			const checkpoint = document.map.createMutationCheckpoint();
			const mutations = [{ x, y, before, after: 0 }];
			document.map.applyAtomicMutations(mutations, []);
			document.map.rollbackAtomicMutations(mutations, [], checkpoint);
			return proof;
		});
		await expect(
			activateRailEditorStartup(payload, new TestScheduler(), undefined, 1, document).then(
				() => "published",
			),
		).rejects.toThrow(/publication document changed/);
		expect(document.map.getRevision()).toBe(revision);
		expect(document.map.getEncoded(x, y)).toBe(before);
		expect(document.getPatchSequence()).toBe(17);
		expect(document.canUndo).toBe(false);
	});

	function startupPayload() {
		return compileRailStartup({
			kind: "snapshot",
			snapshot: captureRailMirrorSnapshot(
				fixture.map,
				17,
				fixture.portEquipment,
				fixture.organizations,
				fixture.relationships,
			).snapshot,
		});
	}
});

class TestScheduler implements RailStartupScheduler {
	yields = 0;
	now(): number {
		return performance.now();
	}
	async yield(): Promise<void> {
		this.yields++;
	}
}
