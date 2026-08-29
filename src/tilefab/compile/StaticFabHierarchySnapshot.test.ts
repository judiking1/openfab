import { describe, expect, it } from "vitest";
import { buildRailModuleOwnershipIndex } from "../core/RailModuleOwnership";
import { collectTransferableBuffers } from "../worker/TransferableBuffers";
import {
	compileStaticFabHierarchyIndex,
	resolveStaticFabProcessRowPairing,
	type StaticFabHierarchyIndex,
	type StaticFabProcessRowPairingResolution,
} from "./StaticFabHierarchy";
import {
	captureStaticFabHierarchyIndexSnapshot,
	hydrateStaticFabHierarchyIndexSnapshot,
	STATIC_FAB_HIERARCHY_SNAPSHOT_SCHEMA_VERSION,
} from "./StaticFabHierarchySnapshot";
import { buildSyntheticFabStarter, defaultSyntheticFabStarterRequest } from "./SyntheticFabStarter";

describe("StaticFabHierarchyIndexSnapshot", () => {
	it("round-trips the 60-Bay hierarchy through compact transferable membership columns", () => {
		const build = buildSyntheticFabStarter(defaultSyntheticFabStarterRequest("large-fab-60"));
		const ownership = buildRailModuleOwnershipIndex(build.document.map);
		const index = compileStaticFabHierarchyIndex(build.document.map, ownership);
		const snapshot = captureStaticFabHierarchyIndexSnapshot(index, ownership);
		const transfers = collectTransferableBuffers(snapshot);
		const transferredBytes = transfers.reduce((total, buffer) => total + buffer.byteLength, 0);

		const delivered = structuredClone(snapshot, { transfer: transfers });
		const hydrated = hydrateStaticFabHierarchyIndexSnapshot(delivered, ownership);
		const expectedMembershipCount = index.branches.reduce(
			(total, branch) =>
				total +
				[
					branch.factory,
					...branch.wings,
					...branch.processRows,
					...branch.processBanks,
					...branch.processBlocks,
				].reduce((sum, node) => sum + node.selection.ownerships.length, 0),
			0,
		);

		expect(snapshot.moduleKeys).toHaveLength(ownership.modules.length);
		expect(delivered.schemaVersion).toBe(STATIC_FAB_HIERARCHY_SNAPSHOT_SCHEMA_VERSION);
		expect(delivered.nodes.count).toBe(28);
		expect(delivered.nodes.ownershipModuleIndices).toHaveLength(expectedMembershipCount);
		expect(transferredBytes).toBeLessThan(128 * 1024);
		expect(hydrated.branches).toHaveLength(index.branches.length);
		expect(hierarchySignature(hydrated)).toEqual(hierarchySignature(index));
		const firstBranch = delivered.branches[0];
		if (!firstBranch) throw new Error("expected transferred FAB hierarchy branch");
		expect(() =>
			hydrateStaticFabHierarchyIndexSnapshot(
				{
					...delivered,
					branches: [
						{
							...firstBranch,
							wingNodeIndices: [] as unknown as Uint32Array,
						},
					],
				},
				ownership,
			),
		).toThrow("indices are malformed");
		expect(() =>
			hydrateStaticFabHierarchyIndexSnapshot(
				{
					...delivered,
					schemaVersion: 1 as typeof STATIC_FAB_HIERARCHY_SNAPSHOT_SCHEMA_VERSION,
				},
				ownership,
			),
		).toThrow("Unsupported FAB hierarchy snapshot schema");
		expect(() =>
			hydrateStaticFabHierarchyIndexSnapshot(
				{
					...delivered,
					nodes: {
						...delivered.nodes,
						keys: delivered.nodes.keys.map((key, index) =>
							index === 1 ? delivered.nodes.keys[0] : key,
						),
					},
				},
				ownership,
			),
		).toThrow("node key");

		const repeatedMembership = delivered.nodes.ownershipModuleIndices.slice();
		repeatedMembership[1] = repeatedMembership[0] as number;
		expect(() =>
			hydrateStaticFabHierarchyIndexSnapshot(
				{
					...delivered,
					nodes: {
						...delivered.nodes,
						ownershipModuleIndices: repeatedMembership,
					},
				},
				ownership,
			),
		).toThrow("repeats ownership module");

		const wrongBounds = delivered.nodes.bounds.slice();
		wrongBounds[0] = (wrongBounds[0] as number) - 1;
		expect(() =>
			hydrateStaticFabHierarchyIndexSnapshot(
				{
					...delivered,
					nodes: { ...delivered.nodes, bounds: wrongBounds },
				},
				ownership,
			),
		).toThrow("bounds do not match");

		const wrongEdgeCounts = delivered.nodes.directedEdgeCounts.slice();
		wrongEdgeCounts[0] = (wrongEdgeCounts[0] as number) + 1;
		expect(() =>
			hydrateStaticFabHierarchyIndexSnapshot(
				{
					...delivered,
					nodes: { ...delivered.nodes, directedEdgeCounts: wrongEdgeCounts },
				},
				ownership,
			),
		).toThrow("directed edge count");
	}, 30_000);

	it.each([
		{
			label: "resolved",
			pairing: resolveStaticFabProcessRowPairing(4, [
				{ rows: [0, 1], sameSideHopCounts: [2, 3] },
				{ rows: [2, 3], sameSideHopCounts: [4, 5] },
			]),
		},
		{
			label: "ambiguous",
			pairing: resolveStaticFabProcessRowPairing(4, [
				{ rows: [0, 1], sameSideHopCounts: [2, 3] },
				{ rows: [2, 3], sameSideHopCounts: [4, 5] },
				{ rows: [1, 2], sameSideHopCounts: [6, 7] },
				{ rows: [0, 3], sameSideHopCounts: [8, 9] },
			]),
		},
		{
			label: "none",
			pairing: resolveStaticFabProcessRowPairing(4, []),
		},
	] satisfies readonly {
		readonly label: string;
		readonly pairing: StaticFabProcessRowPairingResolution;
	}[])("preserves $label topology pairing evidence across Worker transfer", ({ pairing }) => {
		const build = buildSyntheticFabStarter(defaultSyntheticFabStarterRequest("large-fab-60"));
		const ownership = buildRailModuleOwnershipIndex(build.document.map);
		const compiled = compileStaticFabHierarchyIndex(build.document.map, ownership);
		const branch = compiled.branches[0];
		if (!branch) throw new Error("expected a synthetic FAB hierarchy branch");
		const index: StaticFabHierarchyIndex = Object.freeze({
			revision: compiled.revision,
			branches: Object.freeze([
				Object.freeze({
					factory: branch.factory,
					wings: Object.freeze(branch.wings.slice(0, 8)),
					processRows: Object.freeze(branch.processRows.slice(0, 4)),
					processRowPairing: pairing,
					processBanks:
						pairing.state === "resolved"
							? Object.freeze(branch.processBanks.slice(0, 4))
							: Object.freeze([]),
					processBlocks:
						pairing.state === "resolved"
							? Object.freeze(branch.processBlocks.slice(0, 2))
							: Object.freeze([]),
				}),
			]),
		});
		const snapshot = captureStaticFabHierarchyIndexSnapshot(index, ownership);
		const delivered = structuredClone(snapshot, {
			transfer: collectTransferableBuffers(snapshot),
		});
		const hydrated = hydrateStaticFabHierarchyIndexSnapshot(delivered, ownership);

		expect(hydrated.branches[0]?.processRowPairing).toEqual(pairing);

		if (pairing.state === "ambiguous") {
			const malformedPairs = delivered.branches[0]?.processRowPairing.alternativePairs.slice();
			if (!malformedPairs) throw new Error("expected transferred pairing");
			malformedPairs[0] = 99;
			expect(() =>
				hydrateStaticFabHierarchyIndexSnapshot(
					{
						...delivered,
						branches: delivered.branches.map((candidate, index) =>
							index === 0
								? {
										...candidate,
										processRowPairing: {
											...candidate.processRowPairing,
											alternativePairs: malformedPairs,
										},
									}
								: candidate,
						),
					},
					ownership,
				),
			).toThrow("invalid Row index");
		}
	}, 30_000);

	it("rejects Bank/Block nodes when transferred pairing is ambiguous", () => {
		const build = buildSyntheticFabStarter(defaultSyntheticFabStarterRequest("large-fab-60"));
		const ownership = buildRailModuleOwnershipIndex(build.document.map);
		const snapshot = captureStaticFabHierarchyIndexSnapshot(
			compileStaticFabHierarchyIndex(build.document.map, ownership),
			ownership,
		);
		const branch = snapshot.branches[0];
		if (!branch) throw new Error("expected a synthetic FAB hierarchy branch");
		const forged = {
			...snapshot,
			branches: [
				{
					...branch,
					processRowPairing: {
						state: 2 as const,
						pairs: new Uint32Array(),
						totalHopCount: 0,
						alternativePairOffsets: Uint32Array.from([0, 3, 6]),
						alternativePairs: Uint32Array.from([0, 1, 2, 3, 4, 5, 0, 5, 1, 2, 3, 4]),
						alternativeTotalHopCounts: Uint32Array.from([10, 12]),
						reason: "forged ambiguous evidence",
					},
				},
			],
		};

		expect(() => hydrateStaticFabHierarchyIndexSnapshot(forged, ownership)).toThrow(
			"cannot materialize Bank/Block",
		);
	}, 30_000);

	it("rejects a resolved matching outside the two legal wall-adjacent phases", () => {
		const build = buildSyntheticFabStarter(defaultSyntheticFabStarterRequest("large-fab-60"));
		const ownership = buildRailModuleOwnershipIndex(build.document.map);
		const snapshot = captureStaticFabHierarchyIndexSnapshot(
			compileStaticFabHierarchyIndex(build.document.map, ownership),
			ownership,
		);
		const branch = snapshot.branches[0];
		if (!branch) throw new Error("expected a synthetic FAB hierarchy branch");
		const forged = {
			...snapshot,
			branches: [
				{
					...branch,
					processRowPairing: {
						...branch.processRowPairing,
						pairs: Uint32Array.from([0, 2, 1, 4, 3, 5]),
					},
				},
			],
		};

		expect(() => hydrateStaticFabHierarchyIndexSnapshot(forged, ownership)).toThrow(
			"not a legal wall-adjacent Row phase",
		);
	}, 30_000);

	it("rejects canonical Bank ownership that disagrees with resolved Row pairing", () => {
		const build = buildSyntheticFabStarter(defaultSyntheticFabStarterRequest("large-fab-60"));
		const ownership = buildRailModuleOwnershipIndex(build.document.map);
		const snapshot = captureStaticFabHierarchyIndexSnapshot(
			compileStaticFabHierarchyIndex(build.document.map, ownership),
			ownership,
		);
		const branch = snapshot.branches[0];
		if (!branch) throw new Error("expected a synthetic FAB hierarchy branch");
		const forged = {
			...snapshot,
			branches: [
				{
					...branch,
					processBankNodeIndices: Uint32Array.from([...branch.processBankNodeIndices].reverse()),
				},
			],
		};

		expect(() => hydrateStaticFabHierarchyIndexSnapshot(forged, ownership)).toThrow(
			"ownership does not match resolved Row pairing",
		);
	}, 30_000);

	it("rejects an ownership index from a different map even when its revision is forged equal", () => {
		const build = buildSyntheticFabStarter(defaultSyntheticFabStarterRequest("large-fab-60"));
		const ownership = buildRailModuleOwnershipIndex(build.document.map);
		const snapshot = captureStaticFabHierarchyIndexSnapshot(
			compileStaticFabHierarchyIndex(build.document.map, ownership),
			ownership,
		);
		const other = buildSyntheticFabStarter(defaultSyntheticFabStarterRequest("single-loop"));
		const otherOwnership = buildRailModuleOwnershipIndex(other.document.map);
		const sameRevisionOtherOwnership = Object.freeze({
			...otherOwnership,
			revision: snapshot.revision,
		});

		expect(() =>
			hydrateStaticFabHierarchyIndexSnapshot(snapshot, sameRevisionOtherOwnership),
		).toThrow("module count");
	}, 30_000);
});

function hierarchySignature(index: ReturnType<typeof compileStaticFabHierarchyIndex>) {
	return index.branches.map((branch) => ({
		factory: nodeSignature(branch.factory),
		wings: branch.wings.map(nodeSignature),
		rows: branch.processRows.map(nodeSignature),
		rowPairing: branch.processRowPairing,
		banks: branch.processBanks.map(nodeSignature),
		blocks: branch.processBlocks.map(nodeSignature),
	}));
}

function nodeSignature(
	node: ReturnType<typeof compileStaticFabHierarchyIndex>["branches"][number]["factory"],
) {
	return {
		scope: node.scope,
		key: node.key,
		directedEdgeCount: node.directedEdgeCount,
		ownershipKeys: node.selection.ownerships.map((ownership) => ownership.key),
		bounds: node.selection.bounds,
	};
}
