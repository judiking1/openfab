import {
	createRailAreaSelectionFromOwnerships,
	type RailAreaSelection,
} from "../core/RailAreaSelection";
import type { RailModuleOwnership, RailModuleOwnershipIndex } from "../core/RailModuleOwnership";
import {
	type StaticFabHierarchyBranch,
	type StaticFabHierarchyIndex,
	type StaticFabHierarchyNode,
	type StaticFabHierarchyScope,
	type StaticFabProcessRowPairingResolution,
	staticFabProcessRowPairingPhases,
} from "./StaticFabHierarchy";

export const STATIC_FAB_HIERARCHY_SNAPSHOT_SCHEMA_VERSION = 2;

export interface StaticFabHierarchyNodeSnapshot {
	readonly count: number;
	readonly scopes: Uint8Array;
	readonly keys: readonly string[];
	readonly directedEdgeCounts: Uint32Array;
	readonly bounds: Int32Array;
	readonly ownershipOffsets: Uint32Array;
	readonly ownershipModuleIndices: Uint32Array;
}

export interface StaticFabHierarchyBranchSnapshot {
	readonly factoryNodeIndex: number;
	readonly wingNodeIndices: Uint32Array;
	readonly processRowNodeIndices: Uint32Array;
	readonly processRowPairing: StaticFabProcessRowPairingSnapshot;
	readonly processBankNodeIndices: Uint32Array;
	readonly processBlockNodeIndices: Uint32Array;
}

/**
 * Compact topology-pairing evidence.
 *
 * `pairs` and `alternativePairs` store flat Row-index pairs. Alternative offsets count pairs,
 * rather than scalar indices, so each alternative can be sliced without allocating in the Worker.
 */
export interface StaticFabProcessRowPairingSnapshot {
	readonly state: 0 | 1 | 2;
	readonly pairs: Uint32Array;
	readonly totalHopCount: number;
	readonly alternativePairOffsets: Uint32Array;
	readonly alternativePairs: Uint32Array;
	readonly alternativeTotalHopCounts: Uint32Array;
	readonly reason: string;
}

/**
 * Compact structured-clone boundary for hierarchy inference.
 *
 * Module keys cross the Worker boundary once. Hierarchy memberships use CSR indices and are
 * rebound to the main thread's revision-local ownership objects after transfer.
 */
export interface StaticFabHierarchyIndexSnapshot {
	readonly schemaVersion: typeof STATIC_FAB_HIERARCHY_SNAPSHOT_SCHEMA_VERSION;
	readonly revision: number;
	readonly moduleKeys: readonly string[];
	readonly nodes: StaticFabHierarchyNodeSnapshot;
	readonly branches: readonly StaticFabHierarchyBranchSnapshot[];
}

const STATIC_FAB_HIERARCHY_SCOPES = [
	"wing",
	"process-row",
	"process-bank",
	"process-block",
	"factory",
] as const satisfies readonly StaticFabHierarchyScope[];

export function captureStaticFabHierarchyIndexSnapshot(
	index: StaticFabHierarchyIndex,
	ownershipIndex: RailModuleOwnershipIndex,
): StaticFabHierarchyIndexSnapshot {
	if (index.revision !== ownershipIndex.revision) {
		throw new Error("FAB hierarchy and ownership revisions do not match.");
	}
	const moduleKeys = ownershipIndex.modules.map((ownership) => ownership.key);
	const moduleIndexByKey = new Map<string, number>();
	for (const [moduleIndex, key] of moduleKeys.entries()) {
		if (moduleIndexByKey.has(key)) {
			throw new Error(`FAB hierarchy ownership key ${key} is duplicated.`);
		}
		moduleIndexByKey.set(key, moduleIndex);
	}
	const nodes: StaticFabHierarchyNode[] = [];
	const addNodes = (candidates: readonly StaticFabHierarchyNode[]): Uint32Array => {
		const indices = new Uint32Array(candidates.length);
		for (const [candidateIndex, candidate] of candidates.entries()) {
			indices[candidateIndex] = nodes.length;
			nodes.push(candidate);
		}
		return indices;
	};
	const branches = index.branches.map((branch) => {
		if (!branch.processRowPairing) {
			throw new Error("FAB hierarchy branch is missing Process row topology pairing evidence.");
		}
		const factoryNodeIndex = nodes.length;
		nodes.push(branch.factory);
		return {
			factoryNodeIndex,
			wingNodeIndices: addNodes(branch.wings),
			processRowNodeIndices: addNodes(branch.processRows),
			processRowPairing: captureProcessRowPairingSnapshot(branch.processRowPairing),
			processBankNodeIndices: addNodes(branch.processBanks),
			processBlockNodeIndices: addNodes(branch.processBlocks),
		} satisfies StaticFabHierarchyBranchSnapshot;
	});
	const ownershipCount = nodes.reduce(
		(total, candidate) => total + candidate.selection.ownerships.length,
		0,
	);
	assertUint32(nodes.length, "FAB hierarchy node count");
	assertUint32(ownershipCount, "FAB hierarchy membership count");
	const scopes = new Uint8Array(nodes.length);
	const keys = new Array<string>(nodes.length);
	const directedEdgeCounts = new Uint32Array(nodes.length);
	const bounds = new Int32Array(nodes.length * 4);
	const ownershipOffsets = new Uint32Array(nodes.length + 1);
	const ownershipModuleIndices = new Uint32Array(ownershipCount);
	let ownershipOffset = 0;
	for (const [nodeIndex, candidate] of nodes.entries()) {
		const scope = STATIC_FAB_HIERARCHY_SCOPES.indexOf(candidate.scope);
		if (scope < 0) throw new Error(`Unknown FAB hierarchy scope ${candidate.scope}.`);
		scopes[nodeIndex] = scope;
		keys[nodeIndex] = candidate.key;
		assertUint32(candidate.directedEdgeCount, `FAB hierarchy ${candidate.key} edge count`);
		directedEdgeCounts[nodeIndex] = candidate.directedEdgeCount;
		const boundsOffset = nodeIndex * 4;
		assertInt32(candidate.selection.bounds.minX, `FAB hierarchy ${candidate.key} minX`);
		assertInt32(candidate.selection.bounds.minY, `FAB hierarchy ${candidate.key} minY`);
		assertInt32(candidate.selection.bounds.maxX, `FAB hierarchy ${candidate.key} maxX`);
		assertInt32(candidate.selection.bounds.maxY, `FAB hierarchy ${candidate.key} maxY`);
		bounds[boundsOffset] = candidate.selection.bounds.minX;
		bounds[boundsOffset + 1] = candidate.selection.bounds.minY;
		bounds[boundsOffset + 2] = candidate.selection.bounds.maxX;
		bounds[boundsOffset + 3] = candidate.selection.bounds.maxY;
		ownershipOffsets[nodeIndex] = ownershipOffset;
		for (const ownership of candidate.selection.ownerships) {
			const moduleIndex = moduleIndexByKey.get(ownership.key);
			if (moduleIndex === undefined) {
				throw new Error(`FAB hierarchy module ${ownership.key} is absent from ownership.`);
			}
			ownershipModuleIndices[ownershipOffset++] = moduleIndex;
		}
	}
	ownershipOffsets[nodes.length] = ownershipOffset;
	return Object.freeze({
		schemaVersion: STATIC_FAB_HIERARCHY_SNAPSHOT_SCHEMA_VERSION,
		revision: index.revision,
		moduleKeys: Object.freeze(moduleKeys),
		nodes: Object.freeze({
			count: nodes.length,
			scopes,
			keys: Object.freeze(keys),
			directedEdgeCounts,
			bounds,
			ownershipOffsets,
			ownershipModuleIndices,
		}),
		branches: Object.freeze(branches.map((branch) => Object.freeze(branch))),
	});
}

function captureProcessRowPairingSnapshot(
	resolution: StaticFabProcessRowPairingResolution,
): StaticFabProcessRowPairingSnapshot {
	const pairs = flattenProcessRowPairs(resolution.pairs);
	if (resolution.state === "resolved") {
		assertUint32(resolution.totalHopCount, "Process row pairing total hop count");
		return Object.freeze({
			state: 1,
			pairs,
			totalHopCount: resolution.totalHopCount,
			alternativePairOffsets: new Uint32Array([0]),
			alternativePairs: new Uint32Array(0),
			alternativeTotalHopCounts: new Uint32Array(0),
			reason: resolution.reason,
		});
	}
	if (resolution.state === "ambiguous") {
		if (resolution.pairs.length !== 0) {
			throw new Error("Ambiguous Process row pairing cannot publish canonical Row pairs.");
		}
		const pairCount = resolution.alternatives.reduce(
			(total, alternative) => total + alternative.pairs.length,
			0,
		);
		assertUint32(pairCount, "Process row pairing alternative pair count");
		const alternativePairOffsets = new Uint32Array(resolution.alternatives.length + 1);
		const alternativePairs = new Uint32Array(pairCount * 2);
		const alternativeTotalHopCounts = new Uint32Array(resolution.alternatives.length);
		let pairOffset = 0;
		for (const [alternativeIndex, alternative] of resolution.alternatives.entries()) {
			alternativePairOffsets[alternativeIndex] = pairOffset;
			assertUint32(
				alternative.totalHopCount,
				`Process row pairing alternative ${alternativeIndex} total hop count`,
			);
			alternativeTotalHopCounts[alternativeIndex] = alternative.totalHopCount;
			for (const [first, second] of alternative.pairs) {
				assertUint32(first, "Process row pairing first Row index");
				assertUint32(second, "Process row pairing second Row index");
				alternativePairs[pairOffset * 2] = first;
				alternativePairs[pairOffset * 2 + 1] = second;
				pairOffset++;
			}
		}
		alternativePairOffsets[resolution.alternatives.length] = pairOffset;
		return Object.freeze({
			state: 2,
			pairs,
			totalHopCount: 0,
			alternativePairOffsets,
			alternativePairs,
			alternativeTotalHopCounts,
			reason: resolution.reason,
		});
	}
	return Object.freeze({
		state: 0,
		pairs,
		totalHopCount: 0,
		alternativePairOffsets: new Uint32Array([0]),
		alternativePairs: new Uint32Array(0),
		alternativeTotalHopCounts: new Uint32Array(0),
		reason: resolution.reason,
	});
}

function flattenProcessRowPairs(pairs: StaticFabProcessRowPairingResolution["pairs"]): Uint32Array {
	const flattened = new Uint32Array(pairs.length * 2);
	for (const [pairIndex, [first, second]] of pairs.entries()) {
		assertUint32(first, "Process row pairing first Row index");
		assertUint32(second, "Process row pairing second Row index");
		flattened[pairIndex * 2] = first;
		flattened[pairIndex * 2 + 1] = second;
	}
	return flattened;
}

export function hydrateStaticFabHierarchyIndexSnapshot(
	snapshot: StaticFabHierarchyIndexSnapshot,
	ownershipIndex: RailModuleOwnershipIndex,
): StaticFabHierarchyIndex {
	if (snapshot.schemaVersion !== STATIC_FAB_HIERARCHY_SNAPSHOT_SCHEMA_VERSION) {
		throw new Error(`Unsupported FAB hierarchy snapshot schema ${String(snapshot.schemaVersion)}.`);
	}
	if (snapshot.revision !== ownershipIndex.revision) {
		throw new Error("FAB hierarchy snapshot and ownership revisions do not match.");
	}
	const moduleBySnapshotIndex = hydrateSnapshotModules(snapshot.moduleKeys, ownershipIndex);
	validateNodeSnapshot(snapshot.nodes);
	const nodes = new Array<StaticFabHierarchyNode>(snapshot.nodes.count);
	const nodeKeys = new Set<string>();
	for (let nodeIndex = 0; nodeIndex < snapshot.nodes.count; nodeIndex++) {
		const start = snapshot.nodes.ownershipOffsets[nodeIndex] as number;
		const end = snapshot.nodes.ownershipOffsets[nodeIndex + 1] as number;
		if (start === end) throw new Error(`FAB hierarchy node ${nodeIndex} has no ownership.`);
		const ownerships = new Array<RailModuleOwnership>(end - start);
		const membership = new Set<number>();
		for (let membershipIndex = start; membershipIndex < end; membershipIndex++) {
			const moduleIndex = snapshot.nodes.ownershipModuleIndices[membershipIndex] as number;
			if (membership.has(moduleIndex)) {
				throw new Error(`FAB hierarchy node ${nodeIndex} repeats ownership module ${moduleIndex}.`);
			}
			membership.add(moduleIndex);
			const ownership = moduleBySnapshotIndex[moduleIndex];
			if (!ownership) {
				throw new Error(`FAB hierarchy node ${nodeIndex} references module ${moduleIndex}.`);
			}
			ownerships[membershipIndex - start] = ownership;
		}
		const key = snapshot.nodes.keys[nodeIndex];
		const scope = STATIC_FAB_HIERARCHY_SCOPES[snapshot.nodes.scopes[nodeIndex] as number];
		if (!key || !scope) throw new Error(`FAB hierarchy node ${nodeIndex} metadata is invalid.`);
		if (nodeKeys.has(key)) throw new Error(`FAB hierarchy node key ${key} is duplicated.`);
		nodeKeys.add(key);
		const boundsOffset = nodeIndex * 4;
		const minX = snapshot.nodes.bounds[boundsOffset] as number;
		const minY = snapshot.nodes.bounds[boundsOffset + 1] as number;
		const maxX = snapshot.nodes.bounds[boundsOffset + 2] as number;
		const maxY = snapshot.nodes.bounds[boundsOffset + 3] as number;
		const selection = createRailAreaSelectionFromOwnerships(
			ownershipIndex,
			ownerships,
			"fully-contained",
		);
		if (
			selection.bounds.minX !== minX ||
			selection.bounds.minY !== minY ||
			selection.bounds.maxX !== maxX ||
			selection.bounds.maxY !== maxY
		) {
			throw new Error(`FAB hierarchy node ${nodeIndex} bounds do not match its ownership.`);
		}
		const expectedDirectedEdgeCount = directedEdgeCount(selection);
		if (snapshot.nodes.directedEdgeCounts[nodeIndex] !== expectedDirectedEdgeCount) {
			throw new Error(
				`FAB hierarchy node ${nodeIndex} directed edge count does not match its ownership.`,
			);
		}
		nodes[nodeIndex] = Object.freeze({
			scope,
			key,
			selection,
			directedEdgeCount: expectedDirectedEdgeCount,
		});
	}
	const referencedNodes = new Set<number>();
	const branches = snapshot.branches.map((branch, branchIndex) => {
		validateBranchSnapshot(branch, branchIndex);
		const factory = hierarchyNodeAt(
			nodes,
			branch.factoryNodeIndex,
			"factory",
			referencedNodes,
			branchIndex,
		);
		const processRowPairing = hydrateProcessRowPairingSnapshot(
			branch.processRowPairing,
			branch.processRowNodeIndices.length,
			branchIndex,
		);
		const wings = hierarchyNodesAt(
			nodes,
			branch.wingNodeIndices,
			"wing",
			referencedNodes,
			branchIndex,
		);
		const processRows = hierarchyNodesAt(
			nodes,
			branch.processRowNodeIndices,
			"process-row",
			referencedNodes,
			branchIndex,
		);
		const processBanks = hierarchyNodesAt(
			nodes,
			branch.processBankNodeIndices,
			"process-bank",
			referencedNodes,
			branchIndex,
		);
		const processBlocks = hierarchyNodesAt(
			nodes,
			branch.processBlockNodeIndices,
			"process-block",
			referencedNodes,
			branchIndex,
		);
		validateHydratedProcessRowHierarchy(
			processRowPairing,
			wings,
			processRows,
			processBanks,
			processBlocks,
			branchIndex,
		);
		validateFactoryMembership(
			factory,
			[...wings, ...processRows, ...processBanks, ...processBlocks],
			branchIndex,
		);
		return Object.freeze({
			factory,
			wings,
			processRows,
			processRowPairing,
			processBanks,
			processBlocks,
		} satisfies StaticFabHierarchyBranch);
	});
	if (referencedNodes.size !== nodes.length) {
		throw new Error("FAB hierarchy snapshot contains unreferenced nodes.");
	}
	return Object.freeze({ revision: snapshot.revision, branches: Object.freeze(branches) });
}

function hydrateProcessRowPairingSnapshot(
	snapshot: StaticFabProcessRowPairingSnapshot,
	rowCount: number,
	branchIndex: number,
): StaticFabProcessRowPairingResolution {
	validateProcessRowPairingSnapshot(snapshot, rowCount, branchIndex);
	const pairs = hydrateProcessRowPairs(snapshot.pairs);
	if (snapshot.state === 1) {
		return Object.freeze({
			state: "resolved",
			pairs,
			totalHopCount: snapshot.totalHopCount,
			reason: snapshot.reason,
		});
	}
	if (snapshot.state === 2) {
		const alternatives = new Array<{
			readonly pairs: ReturnType<typeof hydrateProcessRowPairs>;
			readonly totalHopCount: number;
		}>(snapshot.alternativeTotalHopCounts.length);
		for (
			let alternativeIndex = 0;
			alternativeIndex < snapshot.alternativeTotalHopCounts.length;
			alternativeIndex++
		) {
			const startPair = snapshot.alternativePairOffsets[alternativeIndex] as number;
			const endPair = snapshot.alternativePairOffsets[alternativeIndex + 1] as number;
			alternatives[alternativeIndex] = Object.freeze({
				pairs: hydrateProcessRowPairs(
					snapshot.alternativePairs.subarray(startPair * 2, endPair * 2),
				),
				totalHopCount: snapshot.alternativeTotalHopCounts[alternativeIndex] as number,
			});
		}
		return Object.freeze({
			state: "ambiguous",
			pairs,
			alternatives: Object.freeze(alternatives),
			reason: snapshot.reason,
		});
	}
	return Object.freeze({
		state: "none",
		pairs: Object.freeze([] as const),
		reason: snapshot.reason,
	});
}

function hydrateProcessRowPairs(flattened: Uint32Array): readonly (readonly [number, number])[] {
	const pairs = new Array<readonly [number, number]>(flattened.length / 2);
	for (let pairIndex = 0; pairIndex < pairs.length; pairIndex++) {
		pairs[pairIndex] = Object.freeze([
			flattened[pairIndex * 2] as number,
			flattened[pairIndex * 2 + 1] as number,
		] as const);
	}
	return Object.freeze(pairs);
}

function hydrateSnapshotModules(
	moduleKeys: readonly string[],
	ownershipIndex: RailModuleOwnershipIndex,
): readonly RailModuleOwnership[] {
	if (moduleKeys.length !== ownershipIndex.modules.length) {
		throw new Error(
			"FAB hierarchy snapshot ownership module count does not match the current map.",
		);
	}
	const seen = new Set<string>();
	return Object.freeze(
		moduleKeys.map((key) => {
			if (typeof key !== "string" || key.length === 0) {
				throw new Error("FAB hierarchy snapshot contains an invalid ownership key.");
			}
			if (seen.has(key)) throw new Error(`FAB hierarchy snapshot repeats ownership key ${key}.`);
			seen.add(key);
			const ownership = ownershipIndex.find(key);
			if (!ownership) {
				throw new Error(`FAB hierarchy snapshot ownership key ${key} is not in the current map.`);
			}
			return ownership;
		}),
	);
}

function validateNodeSnapshot(snapshot: StaticFabHierarchyNodeSnapshot): void {
	if (
		!Number.isSafeInteger(snapshot.count) ||
		snapshot.count < 0 ||
		!(snapshot.scopes instanceof Uint8Array) ||
		!(snapshot.directedEdgeCounts instanceof Uint32Array) ||
		!(snapshot.bounds instanceof Int32Array) ||
		!(snapshot.ownershipOffsets instanceof Uint32Array) ||
		!(snapshot.ownershipModuleIndices instanceof Uint32Array) ||
		snapshot.scopes.length !== snapshot.count ||
		snapshot.keys.length !== snapshot.count ||
		snapshot.directedEdgeCounts.length !== snapshot.count ||
		snapshot.bounds.length !== snapshot.count * 4 ||
		snapshot.ownershipOffsets.length !== snapshot.count + 1 ||
		snapshot.ownershipOffsets[0] !== 0 ||
		snapshot.ownershipOffsets[snapshot.count] !== snapshot.ownershipModuleIndices.length
	) {
		throw new Error("FAB hierarchy node snapshot columns are malformed.");
	}
	let previousOffset = 0;
	for (const offset of snapshot.ownershipOffsets) {
		if (offset < previousOffset || offset > snapshot.ownershipModuleIndices.length) {
			throw new Error("FAB hierarchy node ownership offsets are malformed.");
		}
		previousOffset = offset;
	}
	for (const scope of snapshot.scopes) {
		if (scope >= STATIC_FAB_HIERARCHY_SCOPES.length) {
			throw new Error(`FAB hierarchy scope code ${scope} is invalid.`);
		}
	}
	for (const key of snapshot.keys) {
		if (typeof key !== "string" || key.length === 0) {
			throw new Error("FAB hierarchy node snapshot contains an invalid key.");
		}
	}
	for (let nodeIndex = 0; nodeIndex < snapshot.count; nodeIndex++) {
		const offset = nodeIndex * 4;
		const minX = snapshot.bounds[offset] as number;
		const minY = snapshot.bounds[offset + 1] as number;
		const maxX = snapshot.bounds[offset + 2] as number;
		const maxY = snapshot.bounds[offset + 3] as number;
		if (minX > maxX || minY > maxY) {
			throw new Error(`FAB hierarchy node ${nodeIndex} bounds are malformed.`);
		}
	}
}

function validateBranchSnapshot(
	branch: StaticFabHierarchyBranchSnapshot,
	branchIndex: number,
): void {
	if (!Number.isSafeInteger(branch.factoryNodeIndex) || branch.factoryNodeIndex < 0) {
		throw new Error(`FAB hierarchy branch ${branchIndex} factory index is invalid.`);
	}
	for (const [label, indices] of [
		["wing", branch.wingNodeIndices],
		["process row", branch.processRowNodeIndices],
		["process bank", branch.processBankNodeIndices],
		["process block", branch.processBlockNodeIndices],
	] as const) {
		if (!(indices instanceof Uint32Array)) {
			throw new Error(`FAB hierarchy branch ${branchIndex} ${label} indices are malformed.`);
		}
	}
	if (!branch.processRowPairing || typeof branch.processRowPairing !== "object") {
		throw new Error(`FAB hierarchy branch ${branchIndex} Process row pairing is malformed.`);
	}
}

function validateProcessRowPairingSnapshot(
	snapshot: StaticFabProcessRowPairingSnapshot,
	rowCount: number,
	branchIndex: number,
): void {
	if (
		(snapshot.state !== 0 && snapshot.state !== 1 && snapshot.state !== 2) ||
		!(snapshot.pairs instanceof Uint32Array) ||
		!(snapshot.alternativePairOffsets instanceof Uint32Array) ||
		!(snapshot.alternativePairs instanceof Uint32Array) ||
		!(snapshot.alternativeTotalHopCounts instanceof Uint32Array) ||
		snapshot.pairs.length % 2 !== 0 ||
		snapshot.alternativePairs.length % 2 !== 0 ||
		!Number.isSafeInteger(snapshot.totalHopCount) ||
		snapshot.totalHopCount < 0 ||
		typeof snapshot.reason !== "string" ||
		snapshot.reason.length === 0
	) {
		throw new Error(
			`FAB hierarchy branch ${branchIndex} Process row pairing columns are malformed.`,
		);
	}
	const alternativeCount = snapshot.alternativeTotalHopCounts.length;
	if (
		snapshot.alternativePairOffsets.length !== alternativeCount + 1 ||
		snapshot.alternativePairOffsets[0] !== 0 ||
		snapshot.alternativePairOffsets[alternativeCount] !== snapshot.alternativePairs.length / 2
	) {
		throw new Error(`FAB hierarchy branch ${branchIndex} pairing offsets are malformed.`);
	}
	let previousOffset = 0;
	for (const offset of snapshot.alternativePairOffsets) {
		if (offset < previousOffset || offset > snapshot.alternativePairs.length / 2) {
			throw new Error(`FAB hierarchy branch ${branchIndex} pairing offsets are malformed.`);
		}
		previousOffset = offset;
	}
	validateProcessRowPairIndices(snapshot.pairs, rowCount, branchIndex, "pairing");
	if (snapshot.state === 0) {
		if (
			snapshot.pairs.length !== 0 ||
			snapshot.totalHopCount !== 0 ||
			alternativeCount !== 0 ||
			snapshot.alternativePairs.length !== 0
		) {
			throw new Error(`FAB hierarchy branch ${branchIndex} empty pairing contains evidence.`);
		}
		return;
	}
	if (snapshot.state === 1) {
		if (
			snapshot.pairs.length !== rowCount ||
			alternativeCount !== 0 ||
			snapshot.alternativePairs.length !== 0
		) {
			throw new Error(`FAB hierarchy branch ${branchIndex} resolved pairing is incomplete.`);
		}
		validatePerfectProcessRowMatching(snapshot.pairs, rowCount, branchIndex, "resolved pairing");
		validateLegalProcessRowMatching(snapshot.pairs, rowCount, branchIndex, "resolved pairing");
		return;
	}
	if (snapshot.pairs.length !== 0 || snapshot.totalHopCount !== 0 || alternativeCount < 2) {
		throw new Error(`FAB hierarchy branch ${branchIndex} ambiguous pairing is incomplete.`);
	}
	const alternativeSignatures = new Set<string>();
	for (let alternativeIndex = 0; alternativeIndex < alternativeCount; alternativeIndex++) {
		const startPair = snapshot.alternativePairOffsets[alternativeIndex] as number;
		const endPair = snapshot.alternativePairOffsets[alternativeIndex + 1] as number;
		const alternative = snapshot.alternativePairs.subarray(startPair * 2, endPair * 2);
		validatePerfectProcessRowMatching(
			alternative,
			rowCount,
			branchIndex,
			`pairing alternative ${alternativeIndex}`,
		);
		validateLegalProcessRowMatching(
			alternative,
			rowCount,
			branchIndex,
			`pairing alternative ${alternativeIndex}`,
		);
		const signature = canonicalProcessRowMatchingSignature(alternative);
		if (alternativeSignatures.has(signature)) {
			throw new Error(`FAB hierarchy branch ${branchIndex} repeats a pairing alternative.`);
		}
		alternativeSignatures.add(signature);
	}
}

function validateLegalProcessRowMatching(
	flattened: Uint32Array,
	rowCount: number,
	branchIndex: number,
	label: string,
): void {
	const signature = canonicalProcessRowMatchingSignature(flattened);
	const allowed = new Set(
		staticFabProcessRowPairingPhases(rowCount).map((phase) =>
			phase
				.map(([first, second]) => (first < second ? `${first}:${second}` : `${second}:${first}`))
				.sort()
				.join("|"),
		),
	);
	if (!allowed.has(signature)) {
		throw new Error(
			`FAB hierarchy branch ${branchIndex} ${label} is not a legal wall-adjacent Row phase.`,
		);
	}
}

function validateHydratedProcessRowHierarchy(
	pairing: StaticFabProcessRowPairingResolution,
	wings: readonly StaticFabHierarchyNode[],
	rows: readonly StaticFabHierarchyNode[],
	banks: readonly StaticFabHierarchyNode[],
	blocks: readonly StaticFabHierarchyNode[],
	branchIndex: number,
): void {
	if (pairing.state !== "resolved") {
		if (banks.length > 0 || blocks.length > 0) {
			throw new Error(
				`FAB hierarchy branch ${branchIndex} cannot materialize Bank/Block nodes without resolved Row pairing.`,
			);
		}
		return;
	}
	if (banks.length !== pairing.pairs.length * 2 || blocks.length !== pairing.pairs.length) {
		throw new Error(
			`FAB hierarchy branch ${branchIndex} Bank/Block counts do not match resolved Row pairing.`,
		);
	}
	for (const [pairIndex, [firstRowIndex, secondRowIndex]] of pairing.pairs.entries()) {
		const firstRow = rows[firstRowIndex];
		const secondRow = rows[secondRowIndex];
		const block = blocks[pairIndex];
		if (!firstRow || !secondRow || !block) {
			throw new Error(`FAB hierarchy branch ${branchIndex} resolved Row pairing is incomplete.`);
		}
		validateExactCombinedOwnership(
			block,
			[firstRow, secondRow],
			branchIndex,
			`process block ${pairIndex}`,
		);
		const firstWings = wings.filter((wing) => wing.key.startsWith(`${firstRow.key}-WING-`));
		const secondWings = wings.filter((wing) => wing.key.startsWith(`${secondRow.key}-WING-`));
		if (firstWings.length !== 2 || secondWings.length !== 2) {
			throw new Error(
				`FAB hierarchy branch ${branchIndex} resolved Row pairing does not own two Wings per Row.`,
			);
		}
		for (let column = 0; column < 2; column++) {
			const bank = banks[pairIndex * 2 + column];
			const firstWing = firstWings[column];
			const secondWing = secondWings[column];
			if (!bank || !firstWing || !secondWing) {
				throw new Error(
					`FAB hierarchy branch ${branchIndex} resolved Row pairing is missing a Bank.`,
				);
			}
			validateExactCombinedOwnership(
				bank,
				[firstWing, secondWing],
				branchIndex,
				`process bank ${pairIndex * 2 + column}`,
			);
		}
	}
}

function validateExactCombinedOwnership(
	actual: StaticFabHierarchyNode,
	sources: readonly StaticFabHierarchyNode[],
	branchIndex: number,
	label: string,
): void {
	const expectedKeys = new Set(
		sources.flatMap((source) => source.selection.ownerships.map((ownership) => ownership.key)),
	);
	const actualKeys = new Set(actual.selection.ownerships.map((ownership) => ownership.key));
	if (
		actualKeys.size !== expectedKeys.size ||
		[...expectedKeys].some((key) => !actualKeys.has(key))
	) {
		throw new Error(
			`FAB hierarchy branch ${branchIndex} ${label} ownership does not match resolved Row pairing.`,
		);
	}
}

function canonicalProcessRowMatchingSignature(flattened: Uint32Array): string {
	const pairKeys: string[] = [];
	for (let pairIndex = 0; pairIndex < flattened.length / 2; pairIndex++) {
		const first = flattened[pairIndex * 2] as number;
		const second = flattened[pairIndex * 2 + 1] as number;
		pairKeys.push(first < second ? `${first}:${second}` : `${second}:${first}`);
	}
	return pairKeys.sort().join("|");
}

function validateProcessRowPairIndices(
	flattened: Uint32Array,
	rowCount: number,
	branchIndex: number,
	label: string,
): void {
	const pairKeys = new Set<string>();
	for (let pairIndex = 0; pairIndex < flattened.length / 2; pairIndex++) {
		const first = flattened[pairIndex * 2] as number;
		const second = flattened[pairIndex * 2 + 1] as number;
		if (first >= rowCount || second >= rowCount || first === second) {
			throw new Error(
				`FAB hierarchy branch ${branchIndex} ${label} references an invalid Row index.`,
			);
		}
		const pairKey = first < second ? `${first}:${second}` : `${second}:${first}`;
		if (pairKeys.has(pairKey)) {
			throw new Error(`FAB hierarchy branch ${branchIndex} ${label} repeats a Row pair.`);
		}
		pairKeys.add(pairKey);
	}
}

function validatePerfectProcessRowMatching(
	flattened: Uint32Array,
	rowCount: number,
	branchIndex: number,
	label: string,
): void {
	validateProcessRowPairIndices(flattened, rowCount, branchIndex, label);
	if (rowCount < 2 || rowCount % 2 !== 0 || flattened.length !== rowCount) {
		throw new Error(`FAB hierarchy branch ${branchIndex} ${label} does not cover every Row.`);
	}
	const rows = new Set<number>();
	for (const rowIndex of flattened) {
		if (rows.has(rowIndex)) {
			throw new Error(`FAB hierarchy branch ${branchIndex} ${label} reuses Row ${rowIndex}.`);
		}
		rows.add(rowIndex);
	}
}

function hierarchyNodesAt(
	nodes: readonly StaticFabHierarchyNode[],
	indices: Uint32Array,
	expectedScope: StaticFabHierarchyScope,
	referencedNodes: Set<number>,
	branchIndex: number,
): readonly StaticFabHierarchyNode[] {
	return Object.freeze(
		Array.from(indices, (nodeIndex) =>
			hierarchyNodeAt(nodes, nodeIndex, expectedScope, referencedNodes, branchIndex),
		),
	);
}

function hierarchyNodeAt(
	nodes: readonly StaticFabHierarchyNode[],
	nodeIndex: number,
	expectedScope: StaticFabHierarchyScope,
	referencedNodes: Set<number>,
	branchIndex: number,
): StaticFabHierarchyNode {
	const node = nodes[nodeIndex];
	if (!node || node.scope !== expectedScope) {
		throw new Error(
			`FAB hierarchy branch ${branchIndex} references invalid ${expectedScope} node ${nodeIndex}.`,
		);
	}
	if (referencedNodes.has(nodeIndex)) {
		throw new Error(`FAB hierarchy node ${nodeIndex} is referenced more than once.`);
	}
	referencedNodes.add(nodeIndex);
	return node;
}

function validateFactoryMembership(
	factory: StaticFabHierarchyNode,
	children: readonly StaticFabHierarchyNode[],
	branchIndex: number,
): void {
	const factoryOwnershipKeys = new Set(
		factory.selection.ownerships.map((ownership) => ownership.key),
	);
	for (const child of children) {
		for (const ownership of child.selection.ownerships) {
			if (!factoryOwnershipKeys.has(ownership.key)) {
				throw new Error(
					`FAB hierarchy branch ${branchIndex} node ${child.key} is outside its Factory.`,
				);
			}
		}
	}
}

function directedEdgeCount(selection: RailAreaSelection): number {
	const edgeKeys = new Set<string>();
	for (const ownership of selection.ownerships) {
		for (const edge of ownership.eraseEdges) {
			edgeKeys.add(`${edge.from.x}:${edge.from.y}>${edge.to.x}:${edge.to.y}`);
		}
	}
	return edgeKeys.size;
}

function assertUint32(value: number, label: string): void {
	if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
		throw new Error(`${label} must fit an unsigned 32-bit integer.`);
	}
}

function assertInt32(value: number, label: string): void {
	if (!Number.isSafeInteger(value) || value < -0x8000_0000 || value > 0x7fff_ffff) {
		throw new Error(`${label} must fit a signed 32-bit integer.`);
	}
}
