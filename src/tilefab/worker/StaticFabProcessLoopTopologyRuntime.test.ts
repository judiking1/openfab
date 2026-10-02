import { describe, expect, it, vi } from "vitest";
import { planAdvancedSwitch } from "../core/AdvancedSwitchPlanner";
import { completeCooperativeSteps } from "../core/CooperativeTask";
import { planRailConstruction } from "../core/paint";
import { createRailAreaSelectionFromOwnerships } from "../core/RailAreaSelection";
import { RailDocument } from "../core/RailDocument";
import { buildRailModuleOwnershipIndex } from "../core/RailModuleOwnership";
import { DIR_E, DIR_W } from "../core/railShape";
import { createStaticFabProcessLoopRailCandidatePreparation } from "../core/StaticFabProcessLoopRailCandidate";
import { encodeRailCell, TileMap } from "../core/TileMap";
import { checksumRailMap } from "./RailMirrorChecksum";
import {
	createStaticFabProcessLoopTopologyPacking,
	hydrateStaticFabProcessLoopTopologyColumns,
	staticFabProcessLoopTopologyFingerprintSteps,
	staticFabProcessLoopTopologyTransfers,
} from "./StaticFabProcessLoopTopologyColumns";
import {
	STATIC_FAB_PROCESS_LOOP_TOPOLOGY_PROTOCOL_VERSION,
	type StaticFabProcessLoopTopologyWorkerRequest,
} from "./StaticFabProcessLoopTopologyProtocol";
import { readStaticFabProcessLoopTopologyResult } from "./StaticFabProcessLoopTopologyResponse";
import { checkStaticFabProcessLoopTopologyInWorker } from "./StaticFabProcessLoopTopologyRuntime";

describe("candidate-only Process Loop topology transport", () => {
	it("packs owned exact columns and checks a closed loop without granting authority", () => {
		const f = fixture();
		const before = checksumRailMap(
			f.document.map,
			f.document.portEquipment,
			f.document.organizations,
			f.document.relationships,
		);
		const request = requestFor(f);
		expect(staticFabProcessLoopTopologyTransfers(request.columns)).toHaveLength(7);
		expect(new Set(staticFabProcessLoopTopologyTransfers(request.columns)).size).toBe(7);
		const transported = structuredClone(request, {
			transfer: staticFabProcessLoopTopologyTransfers(request.columns),
		});
		expect(request.columns.edgeCells.byteLength).toBe(0);
		const response = checkStaticFabProcessLoopTopologyInWorker(transported);
		expect(response.type).toBe("STATIC_FAB_PROCESS_LOOP_TOPOLOGY_CHECKED");
		if (response.type !== "STATIC_FAB_PROCESS_LOOP_TOPOLOGY_CHECKED")
			throw new Error(response.message);
		expect(response.result.valid).toBe(true);
		expect(response.result.authoringAuthority).toBe("NONE");
		expect(Object.keys(response.result)).toEqual(["valid", "authoringAuthority", "evidence"]);
		expect(response.source).toEqual(transported.source);
		expect(response.fingerprint).toBe(transported.fingerprint);
		expect(readStaticFabProcessLoopTopologyResult(response.result, 100, 0)).toEqual(
			response.result,
		);
		expect(
			checksumRailMap(
				f.document.map,
				f.document.portEquipment,
				f.document.organizations,
				f.document.relationships,
			),
		).toBe(before);
		expect(f.document.organizations.records).toHaveLength(0);
	});

	it("packs only selected rails without walking or cloning the source map", () => {
		const document = loopDocument();
		const other = planRailConstruction(document.map, { x: 100, y: 100 }, { x: 110, y: 100 });
		expect(document.commit(other)).toBe(true);
		const f = fixture(document, true);
		const traversal = vi.spyOn(document.map, "forEachRail").mockImplementation(() => {
			throw new Error("Full source traversal forbidden");
		});
		const packing = createStaticFabProcessLoopTopologyPacking(f.source, f.candidate, () => true);
		while (!packing.done) packing.step(16);
		const packed = packing.finish();
		expect(packed.columns.edgeCells).toHaveLength(400);
		expect(traversal).not.toHaveBeenCalled();
		traversal.mockRestore();
		const response = checkStaticFabProcessLoopTopologyInWorker({ ...requestFor(f), ...packed });
		expect(response).toMatchObject({
			type: "STATIC_FAB_PROCESS_LOOP_TOPOLOGY_CHECKED",
			result: { valid: true },
		});
	});

	it("preserves an exhausted cursor even when no switch is selected", () => {
		const f = fixture();
		const request = requestFor(f);
		const columns = { ...request.columns, nextAdvancedSwitchId: 0x80000000 };
		expect(hydrateStaticFabProcessLoopTopologyColumns(columns).getAdvancedSwitchIdCursor()).toBe(
			0x80000000,
		);
		expect(
			completeCooperativeSteps(staticFabProcessLoopTopologyFingerprintSteps(columns)),
		).not.toBe(request.fingerprint);
	});

	it("packs sparse closed-switch topology and keeps derived joins out of persisted membership", () => {
		const document = new RailDocument();
		const points = [
			[
				{ x: -20, y: 0 },
				{ x: 0, y: 0 },
			],
		] as const;
		for (const [from, to] of points)
			expect(document.commit(planRailConstruction(document.map, from, to))).toBe(true);
		const switchPlan = planAdvancedSwitch(document.map, { x: 0, y: 0 }, { x: 0, y: 3 }, "C");
		expect(document.commit(switchPlan), switchPlan.reason).toBe(true);
		for (const path of [
			[
				{ x: 6, y: 0 },
				{ x: 20, y: 0 },
				{ x: 20, y: -20 },
				{ x: -20, y: -20 },
				{ x: -20, y: 0 },
			],
			[
				{ x: 4, y: 3 },
				{ x: 4, y: 20 },
				{ x: -10, y: 20 },
				{ x: -10, y: 10 },
				{ x: 2, y: 10 },
				{ x: 2, y: 3 },
			],
		])
			for (let index = 1; index < path.length; index++)
				expect(
					document.commit(
						planRailConstruction(
							document.map,
							path[index - 1] as { x: number; y: number },
							path[index] as { x: number; y: number },
						),
					),
				).toBe(true);
		const hydrator = TileMap.createHydrator();
		document.map.forEachRail((x, y, _rail, encoded) => hydrator.addEncodedCell(x, y, encoded));
		if (!switchPlan.switchRecord) throw new Error("missing synthetic switch");
		hydrator.addAdvancedSwitch({ ...switchPlan.switchRecord, id: 73 });
		const f = fixture(
			RailDocument.fromLoadedMap(hydrator.finish(document.map.getRevision(), 100), 0),
		);
		const request = requestFor(f);
		expect(request.columns.switchIds).toEqual(new Int32Array([73]));
		expect(request.columns.edgeCells.length / 4 - f.candidate.membership.railEdges.length).toBe(4);
		const hydrated = hydrateStaticFabProcessLoopTopologyColumns(request.columns);
		expect(hydrated.getAdvancedSwitch(73)).toEqual(f.document.map.getAdvancedSwitch(73));
		expect(hydrated.getAdvancedSwitchIdCursor()).toBe(100);
		expect(checkStaticFabProcessLoopTopologyInWorker(request)).toMatchObject({
			type: "STATIC_FAB_PROCESS_LOOP_TOPOLOGY_CHECKED",
			result: { valid: true, authoringAuthority: "NONE" },
		});
		const missing = { ...request.columns, edgeCells: new Int32Array(0) };
		expect(
			checkStaticFabProcessLoopTopologyInWorker({
				...request,
				columns: missing,
				fingerprint: completeCooperativeSteps(
					staticFabProcessLoopTopologyFingerprintSteps(missing),
				),
			}),
		).toMatchObject({
			type: "STATIC_FAB_PROCESS_LOOP_TOPOLOGY_ERROR",
			message: expect.stringMatching(/footprint/),
		});
	});

	it("retains negative topology facts when all physical paths are invalid", () => {
		const request = requestFor(fixture());
		const columns = { ...request.columns, edgeCells: new Int32Array([0, 0, 1, 0, 1, 0, 0, 0]) };
		const response = checkStaticFabProcessLoopTopologyInWorker({
			...request,
			columns,
			fingerprint: completeCooperativeSteps(staticFabProcessLoopTopologyFingerprintSteps(columns)),
		});
		if (response.type !== "STATIC_FAB_PROCESS_LOOP_TOPOLOGY_CHECKED")
			throw new Error(response.message);
		expect(response.result.valid).toBe(false);
		expect(response.result.evidence.physicalInvalidPaths).toBeGreaterThan(0);
		expect(response.result.evidence.physicalPaths).toBe(0);
		expect(readStaticFabProcessLoopTopologyResult(response.result, 2, 0)).toEqual(response.result);
	});

	it("rejects altered columns and a different source header", () => {
		const request = requestFor(fixture());
		request.columns.edgeCells[0] = (request.columns.edgeCells[0] as number) + 1;
		expect(checkStaticFabProcessLoopTopologyInWorker(request)).toMatchObject({
			type: "STATIC_FAB_PROCESS_LOOP_TOPOLOGY_ERROR",
			message: expect.stringMatching(/fingerprint/),
		});
		const fresh = requestFor(fixture());
		expect(
			checkStaticFabProcessLoopTopologyInWorker({
				...fresh,
				source: { ...fresh.source, patchSequence: fresh.source.patchSequence + 1 },
			}),
		).toMatchObject({
			type: "STATIC_FAB_PROCESS_LOOP_TOPOLOGY_ERROR",
			message: expect.stringMatching(/source/),
		});
	});

	it("rejects noncanonical coordinates even if their attacker-supplied fingerprint matches", () => {
		const request = requestFor(fixture());
		for (const values of [
			[0, 0, 2, 0],
			[130049, 0, 130050, 0],
			[0, 0, 1, 0, 0, 0, 1, 0],
		]) {
			const columns = { ...request.columns, edgeCells: new Int32Array(values) };
			const fingerprint = completeCooperativeSteps(
				staticFabProcessLoopTopologyFingerprintSteps(columns),
			);
			expect(
				checkStaticFabProcessLoopTopologyInWorker({ ...request, columns, fingerprint }).type,
			).toBe("STATIC_FAB_PROCESS_LOOP_TOPOLOGY_ERROR");
		}
	});

	it("rejects sliced, wrong-width, shared and aliased buffers", () => {
		const request = requestFor(fixture());
		for (const columns of [
			{ ...request.columns, edgeCells: request.columns.edgeCells.subarray(4) },
			{ ...request.columns, edgeCells: new Uint32Array(request.columns.edgeCells) },
			{ ...request.columns, edgeCells: new Int32Array(new SharedArrayBuffer(400 * 4)) },
			{
				...request.columns,
				edgeCells: new Int32Array(0),
				switchIds: new Int32Array(request.columns.switchRecords.origins.buffer),
			},
		])
			expect(() =>
				staticFabProcessLoopTopologyTransfers(columns as typeof request.columns),
			).toThrow();
	});

	it("rejects extra request fields, legacy versions, invalid source digests and request IDs", () => {
		const request = requestFor(fixture());
		for (const malformed of [
			{ ...request, graph: [] },
			{ ...request, version: 0 },
			{ ...request, requestId: 0 },
			{
				...request,
				source: {
					...request.source,
					checksum: request.source.checksum.replace(/^00000003/, "00000002"),
				},
			},
		])
			expect(checkStaticFabProcessLoopTopologyInWorker(malformed).type).toBe(
				"STATIC_FAB_PROCESS_LOOP_TOPOLOGY_ERROR",
			);
	});

	it("rejects inconsistent or unbounded response facts and mutation authority", () => {
		const request = requestFor(fixture());
		const response = checkStaticFabProcessLoopTopologyInWorker(request);
		if (response.type !== "STATIC_FAB_PROCESS_LOOP_TOPOLOGY_CHECKED")
			throw new Error(response.message);
		for (const result of [
			{ ...response.result, valid: false },
			{ ...response.result, authoringAuthority: "COMMIT" },
			{ ...response.result, plan: {} },
			...[-1, Number.NaN, 1.5, Number.MAX_SAFE_INTEGER].map((authoredCells) => ({
				...response.result,
				evidence: { ...response.result.evidence, authoredCells },
			})),
			{ ...response.result, evidence: { ...response.result.evidence, authoredEdges: 99 } },
			{ ...response.result, evidence: { ...response.result.evidence, physicalClearanceIssues: 1 } },
		])
			expect(() => readStaticFabProcessLoopTopologyResult(result, 100, 0)).toThrow();
	});

	it("permanently discards packing on cancellation or stale source", () => {
		const f = fixture();
		let current = true;
		const packing = createStaticFabProcessLoopTopologyPacking(f.source, f.candidate, () => current);
		packing.step(1);
		current = false;
		expect(packing.done).toBe(true);
		current = true;
		expect(() => packing.finish()).toThrow(/current/);
		const cancelled = createStaticFabProcessLoopTopologyPacking(f.source, f.candidate, () => true);
		cancelled.step(2);
		cancelled.cancel();
		expect(cancelled.done).toBe(true);
		expect(() => cancelled.finish()).toThrow(/cancelled/);
	});

	it("packs a genuine 100k-cell selection with bounded reference/hash slices", () => {
		const hydrator = TileMap.createHydrator();
		for (let x = 0; x < 100_000; x++)
			hydrator.addEncodedCell(
				x,
				0,
				encodeRailCell({ incoming: x === 0 ? 0 : DIR_W, outgoing: x === 99_999 ? 0 : DIR_E }),
			);
		const f = fixture(RailDocument.fromLoadedMap(hydrator.finish(1), 0));
		const packing = createStaticFabProcessLoopTopologyPacking(f.source, f.candidate, () => true);
		let slices = 0;
		while (!packing.done) {
			expect(packing.step(128)).toBeLessThanOrEqual(128);
			slices++;
		}
		const packed = packing.finish();
		expect(packed.columns.edgeCells).toHaveLength(99_999 * 4);
		expect(slices).toBeGreaterThan(3000);
		expect(packed.fingerprint).toBe(
			completeCooperativeSteps(staticFabProcessLoopTopologyFingerprintSteps(packed.columns)),
		);
	}, 30_000);
});

function fixture(document = loopDocument(), selectedOnly = false) {
	const ownership = buildRailModuleOwnershipIndex(document.map);
	const modules = selectedOnly
		? ownership.modules.filter((module) =>
				module.eraseEdges.every((edge) => edge.from.x < 40 && edge.to.x < 40),
			)
		: ownership.modules;
	const rail = createRailAreaSelectionFromOwnerships(ownership, modules);
	const source = Object.freeze({
		map: document.map,
		ownership,
		organizations: document.organizations,
		patchSequence: document.getPatchSequence(),
		selection: Object.freeze({
			baseRevision: document.map.getRevision(),
			basePatchSequence: document.getPatchSequence(),
			rail,
			equipmentGroups: Object.freeze([]),
		}),
	});
	const task = createStaticFabProcessLoopRailCandidatePreparation(source, () => true);
	while (!task.done) task.step(128);
	const result = task.finish();
	if (!result.valid) throw new Error(result.error.code);
	return { document, source, candidate: result.candidate };
}

function requestFor(f: ReturnType<typeof fixture>): StaticFabProcessLoopTopologyWorkerRequest {
	const packing = createStaticFabProcessLoopTopologyPacking(f.source, f.candidate, () => true);
	while (!packing.done) packing.step(128);
	const packed = packing.finish();
	return {
		type: "CHECK_STATIC_FAB_PROCESS_LOOP_TOPOLOGY",
		version: STATIC_FAB_PROCESS_LOOP_TOPOLOGY_PROTOCOL_VERSION,
		requestId: 1,
		source: {
			revision: f.document.map.getRevision(),
			patchSequence: f.document.getPatchSequence(),
			epoch: 2,
			checksum: checksumRailMap(
				f.document.map,
				f.document.portEquipment,
				f.document.organizations,
				f.document.relationships,
			),
			nextAdvancedSwitchId: f.document.map.getAdvancedSwitchIdCursor(),
			nextPortId: f.document.portEquipment.nextPortId,
			nextEquipmentGroupId: f.document.portEquipment.nextEquipmentGroupId,
			nextOrganizationId: f.document.organizations.nextOrganizationId,
			nextRelationshipId: f.document.relationships.nextRelationshipId,
		},
		...packed,
	};
}

function loopDocument(): RailDocument {
	const document = new RailDocument();
	const points = [
		{ x: 0, y: 0 },
		{ x: 30, y: 0 },
		{ x: 30, y: 20 },
		{ x: 0, y: 20 },
		{ x: 0, y: 0 },
	];
	for (let index = 1; index < points.length; index++) {
		const plan = planRailConstruction(
			document.map,
			points[index - 1] as { x: number; y: number },
			points[index] as { x: number; y: number },
		);
		expect(document.commit(plan), plan.reason).toBe(true);
	}
	return document;
}
