import { describe, expect, it, vi } from "vitest";
import { RailDocument } from "../core/RailDocument";
import type {
	StaticFabOrganizationMutation,
	StaticFabOrganizationRecord,
	StaticFabOrganizationSemanticRole,
	StaticFabOrganizationState,
} from "../core/StaticFabOrganization";
import { TileMap } from "../core/TileMap";
import {
	type OrdinaryDuplicatedAssemblyPlacementReceipt,
	ordinaryDuplicatedAssemblyNeedsTwinBayRecognition,
	ordinaryDuplicatedAssemblyReceiptIsCurrent,
	ordinaryDuplicatedAssemblyRedoCandidate,
	ordinaryDuplicatedAssemblyRedoProjection,
	ordinaryDuplicatedAssemblyRootRole,
	ordinaryDuplicatedAssemblyUndoCandidate,
	ordinaryDuplicatedAssemblyUndoProjection,
	ordinaryPlacedAssemblyReceiptInvalidationReason,
	recognizeOrdinaryPlacedAssembly,
} from "./OrdinaryDuplicatedAssemblyPlacementReceipt";

describe("recognizeOrdinaryPlacedAssembly", () => {
	it("binds the exact nonzero bundle root index instead of the organization cursor", () => {
		const document = new RailDocument();
		const source = record(7, "AREA");
		const unrelated = record(14, "PROCESS_FAMILY");
		const placed = record(21, "AREA");
		const organizations = state([source, unrelated, placed], 99);
		const recognition = recognizeOrdinaryPlacedAssembly({
			document,
			patchSequence: 11,
			bundleFingerprint: "bank-bundle",
			guidedBuildActive: false,
			rootOrganizationIndices: [1],
			organizationMutations: [mutation(14, unrelated), mutation(21, placed)],
			origin: "selection-copy",
			captureMode: "EFFECTIVE",
			sourceRootOrganizationIds: [7],
			map: new TileMap(),
			organizations,
			semanticRoles: roles([
				[7, "BAY_BANK"],
				[21, "BAY_BANK"],
			]),
		});

		expect(recognition?.placedRoot.id).toBe(21);
		expect(recognition?.duplicateSourceRoot?.id).toBe(7);
		expect(recognition?.receipt).toMatchObject({
			document,
			patchSequence: 11,
			bundleFingerprint: "bank-bundle",
			sourceRootOrganizationId: 7,
			placedRootOrganizationId: 21,
			role: "BAY_BANK",
			phase: "placed",
		});
	});

	it("rejects a wrong root index and a source whose current DAG role changed", () => {
		const document = new RailDocument();
		const source = record(7, "AREA");
		const target = record(21, "AREA");
		const base = {
			document,
			patchSequence: 11,
			bundleFingerprint: "bank-bundle",
			guidedBuildActive: false,
			organizationMutations: [mutation(21, target)],
			origin: "selection-copy",
			captureMode: "EFFECTIVE" as const,
			sourceRootOrganizationIds: [7],
			map: new TileMap(),
			organizations: state([source, target], 22),
		};
		expect(
			recognizeOrdinaryPlacedAssembly({
				...base,
				rootOrganizationIndices: [3],
				semanticRoles: roles([
					[7, "BAY_BANK"],
					[21, "BAY_BANK"],
				]),
			}),
		).toBeNull();
		expect(
			recognizeOrdinaryPlacedAssembly({
				...base,
				rootOrganizationIndices: [0],
				semanticRoles: roles([[21, "BAY_BANK"]]),
			}),
		).toBeNull();
	});
});

describe("ordinary duplicated assembly receipt authority", () => {
	it("keeps Bay Bank role recognition on the supplied constant-time semantic path", () => {
		const recognizeTwinBay = vi.fn(() => true);
		expect(ordinaryDuplicatedAssemblyNeedsTwinBayRecognition("BAY_BANK")).toBe(false);
		expect(ordinaryDuplicatedAssemblyNeedsTwinBayRecognition(undefined, true)).toBe(false);
		expect(ordinaryDuplicatedAssemblyNeedsTwinBayRecognition("BAY")).toBe(true);
		expect(ordinaryDuplicatedAssemblyNeedsTwinBayRecognition(undefined)).toBe(true);
		expect(ordinaryDuplicatedAssemblyRootRole("BAY_BANK", recognizeTwinBay)).toBe("BAY_BANK");
		expect(recognizeTwinBay).not.toHaveBeenCalled();
		expect(ordinaryDuplicatedAssemblyRootRole(undefined, recognizeTwinBay)).toBe("TWIN_BAY");
		expect(recognizeTwinBay).toHaveBeenCalledTimes(1);
	});

	it("defers semantic invalidation while a large placement projection is synchronizing", () => {
		const base = {
			placementActive: true,
			placedRootOrganizationId: 21,
			modelSyncPending: true,
			placedRootExists: true,
			redoAvailable: false,
			recognizedTwinBay: false,
			recognizedBayBank: false,
		};
		expect(ordinaryPlacedAssemblyReceiptInvalidationReason(base)).toBeNull();
		expect(
			ordinaryPlacedAssemblyReceiptInvalidationReason({
				...base,
				modelSyncPending: false,
				recognizedBayBank: true,
			}),
		).toBeNull();
		expect(
			ordinaryPlacedAssemblyReceiptInvalidationReason({
				...base,
				modelSyncPending: false,
			}),
		).toBe("unrecognized-root");
		expect(
			ordinaryPlacedAssemblyReceiptInvalidationReason({
				...base,
				modelSyncPending: false,
				placedRootExists: false,
				redoAvailable: true,
			}),
		).toBeNull();
		expect(
			ordinaryPlacedAssemblyReceiptInvalidationReason({
				...base,
				modelSyncPending: false,
				placedRootExists: false,
				redoAvailable: false,
			}),
		).toBe("missing-root");
	});

	it("rejects foreign, stale, and retyped current receipts", () => {
		const document = new RailDocument();
		const receipt = placedReceipt(document);
		const current = {
			document,
			patchSequence: 11,
			bundleFingerprint: "bank-bundle",
			sourceRootOrganizationId: 7,
			placedRootOrganizationId: 21,
			expectedRole: "BAY_BANK" as const,
			sourceRole: "BAY_BANK" as const,
			placedRole: "BAY_BANK" as const,
		};
		expect(ordinaryDuplicatedAssemblyReceiptIsCurrent(receipt, current)).toBe(true);
		expect(
			ordinaryDuplicatedAssemblyReceiptIsCurrent(receipt, {
				...current,
				document: new RailDocument(),
			}),
		).toBe(false);
		expect(
			ordinaryDuplicatedAssemblyReceiptIsCurrent(receipt, {
				...current,
				patchSequence: 12,
			}),
		).toBe(false);
		expect(
			ordinaryDuplicatedAssemblyReceiptIsCurrent(receipt, {
				...current,
				sourceRole: null,
			}),
		).toBe(false);
	});

	it("advances only the exact pair through target absence and reappearance", () => {
		const document = new RailDocument();
		const source = record(7, "AREA");
		const target = record(21, "AREA");
		const receipt = placedReceipt(document);
		const undoCandidate = ordinaryDuplicatedAssemblyUndoCandidate(receipt, {
			document,
			patchSequence: 11,
			retainedBundleFingerprint: null,
			selectedOrganizationIds: [21, 7],
		});
		expect(undoCandidate).toBe(receipt);
		if (!undoCandidate) throw new Error("Expected the exact duplicate Undo receipt.");
		const undone = ordinaryDuplicatedAssemblyUndoProjection(undoCandidate, {
			document,
			patchSequence: 12,
			map: new TileMap(),
			organizations: state([source], 22),
			semanticRoles: roles([[7, "BAY_BANK"]]),
		});
		expect(undone).toMatchObject({
			receipt: { phase: "undone", patchSequence: 12 },
			sourceRoot: { id: 7 },
		});
		expect(
			ordinaryDuplicatedAssemblyUndoProjection(undoCandidate, {
				document,
				patchSequence: 12,
				map: new TileMap(),
				organizations: state([source, target], 22),
				semanticRoles: roles([
					[7, "BAY_BANK"],
					[21, "BAY_BANK"],
				]),
			}),
		).toBeNull();
		if (!undone) throw new Error("Expected an exact post-Undo projection.");
		const redoCandidate = ordinaryDuplicatedAssemblyRedoCandidate(undone.receipt, {
			document,
			patchSequence: 12,
			retainedBundleFingerprint: null,
			selectedOrganizationIds: [7],
			map: new TileMap(),
			organizations: state([source], 22),
			semanticRoles: () => roles([[7, "BAY_BANK"]]),
		});
		expect(redoCandidate).toBe(undone.receipt);
		if (!redoCandidate) throw new Error("Expected the exact duplicate Redo receipt.");
		expect(
			ordinaryDuplicatedAssemblyRedoProjection(redoCandidate, {
				document,
				patchSequence: 13,
				map: new TileMap(),
				organizations: state([source, target], 22),
				semanticRoles: roles([
					[7, "BAY_BANK"],
					[21, "BAY_BANK"],
				]),
			}),
		).toMatchObject({
			receipt: { phase: "placed", patchSequence: 13 },
			sourceRoot: { id: 7 },
			placedRoot: { id: 21 },
		});
		expect(
			ordinaryDuplicatedAssemblyRedoProjection(redoCandidate, {
				document,
				patchSequence: 13,
				map: new TileMap(),
				organizations: state([source, target], 22),
				semanticRoles: roles([[7, "BAY_BANK"]]),
			}),
		).toBeNull();
	});

	it("keeps unrelated and foreign Redo history scan-free at 100k organizations", () => {
		const document = new RailDocument();
		const receipt = { ...placedReceipt(document), patchSequence: 12, phase: "undone" as const };
		const source = record(100_001, "AREA");
		const organizations = state(
			[
				...Array.from({ length: 100_000 }, (_, index) => record(index + 1, "PROCESS_FAMILY")),
				source,
			],
			100_003,
		);
		const largeReceipt = Object.freeze({
			...receipt,
			sourceRootOrganizationId: 100_001,
			placedRootOrganizationId: 100_002,
		});
		const semanticRoles = vi.fn(() => roles([[100_001, "BAY_BANK"]]));
		const base = {
			document,
			patchSequence: 12,
			retainedBundleFingerprint: null,
			selectedOrganizationIds: [100_001],
			map: new TileMap(),
			organizations,
			semanticRoles,
		};

		expect(ordinaryDuplicatedAssemblyRedoCandidate(null, base)).toBeNull();
		expect(
			ordinaryDuplicatedAssemblyRedoCandidate(
				Object.freeze({ ...largeReceipt, document: new RailDocument() }),
				base,
			),
		).toBeNull();
		expect(
			ordinaryDuplicatedAssemblyRedoCandidate(largeReceipt, {
				...base,
				selectedOrganizationIds: [1],
			}),
		).toBeNull();
		expect(semanticRoles).not.toHaveBeenCalled();
		expect(ordinaryDuplicatedAssemblyRedoCandidate(largeReceipt, base)).toBe(largeReceipt);
		expect(semanticRoles).toHaveBeenCalledTimes(1);
	}, 10_000);
});

function placedReceipt(document: RailDocument): OrdinaryDuplicatedAssemblyPlacementReceipt {
	return Object.freeze({
		document,
		patchSequence: 11,
		bundleFingerprint: "bank-bundle",
		sourceRootOrganizationId: 7,
		placedRootOrganizationId: 21,
		role: "BAY_BANK",
		phase: "placed",
	});
}

function state(
	records: readonly StaticFabOrganizationRecord[],
	nextOrganizationId: number,
): StaticFabOrganizationState {
	return Object.freeze({
		nextOrganizationId,
		records: Object.freeze([...records].sort((left, right) => left.id - right.id)),
	});
}

function record(
	id: number,
	kind: StaticFabOrganizationRecord["kind"],
): StaticFabOrganizationRecord {
	return Object.freeze({
		id,
		kind,
		name: `${kind}-${id}`,
		parentOrganizationIds: Object.freeze([]),
		membership: Object.freeze({
			railEdges: Object.freeze([]),
			advancedSwitchIds: Object.freeze([]),
			equipmentGroupIds: Object.freeze([]),
		}),
	});
}

function mutation(id: number, after: StaticFabOrganizationRecord): StaticFabOrganizationMutation {
	return Object.freeze({ id, before: null, after });
}

function roles(
	entries: readonly (readonly [number, StaticFabOrganizationSemanticRole])[],
): ReadonlyMap<number, StaticFabOrganizationSemanticRole> {
	return new Map(entries);
}
