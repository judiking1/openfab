import { describe, expect, it, vi } from "vitest";
import { planRailConstruction } from "../core/paint";
import { RailDocument } from "../core/RailDocument";
import {
	captureRailMirrorSnapshot,
	consumeRailMirrorSnapshotCaptureAuthority,
	type RailMirrorSnapshot,
} from "../worker/RailMirrorChecksum";
import { INITIAL_RAIL_WORKER_STATE, type RailWorkerBridgeState } from "../worker/RailWorkerBridge";
import { captureOrganizationBundlePlacementSnapshot } from "./OrganizationBundlePlacementSnapshot";

describe("organization bundle placement snapshot", () => {
	it("uses the owned mirror snapshot without traversing the document or requiring physical validity", async () => {
		const fixture = createFixture();
		const traversal = vi.spyOn(fixture.document.map, "forEachRail");
		const pending = fixture.capture();
		expect(fixture.mirror.captureCurrentSnapshot).not.toHaveBeenCalled();
		fixture.ready.resolve(fixture.state);
		await Promise.resolve();
		expect(fixture.mirror.captureCurrentSnapshot).toHaveBeenCalledWith(fixture.controller.signal);
		fixture.captured.resolve(fixture.snapshot);
		await expect(pending).resolves.toBe(fixture.snapshot);
		expect(traversal).not.toHaveBeenCalled();
		expect(fixture.state.physicalValid).toBe(false);
		expect(fixture.consumeAuthority()).toBe(true);
		expect(fixture.consumeAuthority()).toBe(false);
	});

	it.each(["readiness", "capture"] as const)("rejects changed source after %s", async (phase) => {
		const fixture = createFixture();
		const pending = fixture.capture();
		if (phase === "capture") {
			fixture.ready.resolve(fixture.state);
			await Promise.resolve();
		}
		expect(
			fixture.document.commit(
				planRailConstruction(fixture.document.map, { x: 12, y: 0 }, { x: 12, y: 12 }),
			),
		).toBe(true);
		fixture.ready.resolve(fixture.state);
		fixture.captured.resolve(fixture.snapshot);
		await expect(pending).rejects.toThrow(/원본 문서가 변경/);
		if (phase === "readiness") expect(fixture.mirror.captureCurrentSnapshot).not.toHaveBeenCalled();
	});

	it.each([
		"readiness",
		"capture",
	] as const)("does not publish a cancelled or superseded %s", async (phase) => {
		for (const cancel of ["abort", "supersede"]) {
			const fixture = createFixture();
			const pending = fixture.capture();
			if (phase === "capture") {
				fixture.ready.resolve(fixture.state);
				await Promise.resolve();
			}
			if (cancel === "abort") fixture.controller.abort();
			else fixture.current = false;
			fixture.ready.resolve(fixture.state);
			fixture.captured.resolve(fixture.snapshot);
			await expect(pending).rejects.toMatchObject({ name: "AbortError" });
			if (phase === "readiness")
				expect(fixture.mirror.captureCurrentSnapshot).not.toHaveBeenCalled();
			else expect(fixture.consumeAuthority()).toBe(false);
		}
	});

	it("does not dispatch an already cancelled request or one for another mirror target", async () => {
		const cancelled = createFixture();
		cancelled.controller.abort();
		await expect(cancelled.capture()).rejects.toMatchObject({ name: "AbortError" });
		expect(cancelled.mirror.waitUntilSnapshotReady).not.toHaveBeenCalled();
		for (const changed of [
			{ targetSequence: 100 },
			{ targetRevision: 100 },
			{ targetCells: 100 },
			{ targetAssemblyRelationships: 1 },
			{ targetAssemblyRelationshipNextId: 100 },
			{ simulationReady: true },
			{ status: "error" as const },
		]) {
			const fixture = createFixture();
			Object.assign(fixture.state, changed);
			await expect(fixture.capture()).rejects.toThrow(/Rail mirror를 찾지/);
			expect(fixture.mirror.waitUntilSnapshotReady).not.toHaveBeenCalled();
		}
	});

	it.each([
		"readiness",
		"capture",
	] as const)("checks the actual mirror again after %s", async (phase) => {
		const fixture = createFixture();
		const pending = fixture.capture();
		if (phase === "capture") {
			fixture.ready.resolve(fixture.state);
			await Promise.resolve();
		}
		fixture.state.targetChecksum = "different";
		fixture.ready.resolve(fixture.state);
		fixture.captured.resolve(fixture.snapshot);
		await expect(pending).rejects.toThrow(/mirror 세대가 변경/);
	});

	it("rejects mismatched snapshot headers and allocator cursors", async () => {
		const changes: ((snapshot: RailMirrorSnapshot) => RailMirrorSnapshot)[] = [
			(s) => ({ ...s, sequence: s.sequence + 1 }),
			(s) => ({ ...s, revision: s.revision + 1 }),
			(s) => ({ ...s, checksum: "forged" }),
			(s) => ({ ...s, nextAdvancedSwitchId: s.nextAdvancedSwitchId + 1 }),
			(s) => ({
				...s,
				portEquipment: { ...s.portEquipment, nextPortId: s.portEquipment.nextPortId + 1 },
			}),
			(s) => ({
				...s,
				portEquipment: {
					...s.portEquipment,
					nextEquipmentGroupId: s.portEquipment.nextEquipmentGroupId + 1,
				},
			}),
			(s) => ({
				...s,
				organizations: {
					...s.organizations,
					nextOrganizationId: s.organizations.nextOrganizationId + 1,
				},
			}),
			(s) => ({
				...s,
				relationships: {
					...s.relationships,
					nextRelationshipId: s.relationships.nextRelationshipId + 1,
				},
			}),
		];
		for (const change of changes) {
			const fixture = createFixture();
			const pending = fixture.capture();
			fixture.ready.resolve(fixture.state);
			fixture.captured.resolve(change(fixture.snapshot));
			await expect(pending).rejects.toThrow(/스냅샷이 현재 문서와 일치하지/);
		}
	});
});

function createFixture() {
	const document = new RailDocument();
	expect(document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 12, y: 0 }))).toBe(
		true,
	);
	const snapshot = captureRailMirrorSnapshot(
		document.map,
		document.getPatchSequence(),
		document.portEquipment,
		document.organizations,
		document.relationships,
	).snapshot;
	const state: RailWorkerBridgeState = {
		...INITIAL_RAIL_WORKER_STATE,
		physicalValid: false,
		status: "ready",
		epoch: 1,
		targetSequence: snapshot.sequence,
		sequence: snapshot.sequence,
		targetRevision: snapshot.revision,
		revision: snapshot.revision,
		targetChecksum: snapshot.checksum,
		checksum: snapshot.checksum,
		targetCells: document.map.size,
		cells: document.map.size,
		targetEdges: document.map.edgeCount,
		edges: document.map.edgeCount,
	};
	const ready = deferred<RailWorkerBridgeState>();
	const captured = deferred<RailMirrorSnapshot>();
	const mirror = {
		getState: () => state,
		waitUntilSnapshotReady: vi.fn(() => ready.promise),
		captureCurrentSnapshot: vi.fn((signal: AbortSignal) => {
			expect(signal).toBe(controller.signal);
			return captured.promise;
		}),
	};
	const controller = new AbortController();
	const fixture = {
		document,
		snapshot,
		state,
		ready,
		captured,
		mirror,
		controller,
		current: true,
		consumeAuthority: () =>
			consumeRailMirrorSnapshotCaptureAuthority(
				snapshot,
				document.map,
				document.getPatchSequence(),
				document.portEquipment,
				document.organizations,
				document.relationships,
			),
		capture: () =>
			captureOrganizationBundlePlacementSnapshot(
				document,
				mirror,
				controller.signal,
				() => fixture.current,
			),
	};
	return fixture;
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
