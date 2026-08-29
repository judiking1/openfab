import {
	type AdvancedSwitchProfileClass,
	type AdvancedSwitchRecord,
	deriveAdvancedSwitchGeometry,
} from "./AdvancedSwitch";
import {
	type CompoundRailEntry,
	type CompoundRailPattern,
	collectCompoundRailPatterns,
} from "./CompoundRailPattern";
import { OrderedTypedChecksum } from "./OrderedTypedChecksum";
import {
	planRailErase,
	type RailErasePlan,
	type RailMutation,
	railMutationTopologyError,
} from "./paint";
import { type AuthoredRailType, classifyRailCell } from "./RailCellClassification";
import type { RailConstructionCatalogId, RailConstructionGrammar } from "./RailConstructionCatalog";
import type { RailModuleSide, RailModuleSpan } from "./RailModulePlanner";
import {
	ALL_DIRECTIONS,
	bitCount,
	type Direction,
	directionBetween,
	moveCell,
	oppositeDirection,
} from "./railShape";
import {
	type Cell,
	cellKey,
	decodeRailCell,
	encodeRailCell,
	type RailCell,
	type TileMap,
} from "./TileMap";
import { collectTurnoutFootprints, TURNOUT_KIND, type TurnoutFootprint } from "./turnout";

export type RailModuleKind =
	| "straight"
	| "turn"
	| "u-turn"
	| "shift"
	| "turnout"
	| "advanced-switch";

export interface DirectedRailEdge {
	readonly from: Cell;
	readonly to: Cell;
}

export interface RailModuleBoundary {
	readonly role: "input" | "output";
	readonly cell: Cell;
	readonly direction: Direction;
}

export interface RailModuleConstructionDescriptor {
	readonly catalogId: RailConstructionCatalogId;
	readonly grammar: RailConstructionGrammar;
	readonly forward: Direction;
	readonly span: RailModuleSpan | null;
	readonly side: RailModuleSide | null;
	readonly advancedSwitchProfile: AdvancedSwitchProfileClass | null;
	readonly lengthMeters: number | null;
}

export interface RailModuleOwnership {
	readonly revision: number;
	readonly key: string;
	readonly kind: RailModuleKind;
	readonly primaryCells: readonly Cell[];
	readonly footprintCells: readonly Cell[];
	readonly eraseEdges: readonly DirectedRailEdge[];
	readonly boundaries: readonly RailModuleBoundary[];
	readonly construction: RailModuleConstructionDescriptor;
	readonly advancedSwitchId: number | null;
}

export type RailModuleOwnershipResolution =
	| { readonly status: "resolved"; readonly module: RailModuleOwnership }
	| {
			readonly status: "ambiguous";
			readonly candidates: readonly RailModuleOwnership[];
			readonly reason: string;
	  }
	| { readonly status: "none"; readonly reason: string };

export interface RailRouteHint {
	readonly incoming: Direction;
	readonly outgoing: Direction;
	readonly role?: "through" | "turnout-diverge";
}

export interface RailModuleOwnershipIndex {
	readonly revision: number;
	readonly modules: readonly RailModuleOwnership[];
	/** Return the immutable, locally bounded ownership candidates registered at one authored cell. */
	candidates(cell: Cell): readonly RailModuleOwnership[];
	resolve(cell: Cell, routeHint?: RailRouteHint): RailModuleOwnershipResolution;
	find(key: string): RailModuleOwnership | null;
	captureSnapshot(): RailModuleOwnershipIndexSnapshot;
}

export interface RailModuleOwnershipIndexSnapshot {
	readonly revision: number;
	readonly modules: RailModuleOwnershipModulesSnapshot;
	readonly candidateCells: Int32Array;
	readonly candidateOffsets: Uint32Array;
	readonly candidateModuleIndices: Uint32Array;
}

export interface RailModuleOwnershipModulesSnapshot {
	readonly moduleCount: number;
	readonly keys: readonly string[];
	readonly kinds: Uint8Array;
	readonly advancedSwitchIds: Int32Array;
	readonly catalogIds: Uint8Array;
	readonly grammars: Uint8Array;
	readonly forwards: Uint8Array;
	readonly spans: Uint8Array;
	readonly sides: Uint8Array;
	readonly advancedSwitchProfiles: Uint8Array;
	readonly lengthMeters: Float64Array;
	readonly primaryOffsets: Uint32Array;
	readonly primaryCells: Int32Array;
	readonly footprintOffsets: Uint32Array;
	readonly footprintCells: Int32Array;
	readonly eraseOffsets: Uint32Array;
	readonly eraseCells: Int32Array;
	readonly boundaryOffsets: Uint32Array;
	readonly boundaryRoles: Uint8Array;
	readonly boundaryCells: Int32Array;
	readonly boundaryDirections: Uint8Array;
}

export interface RailModuleOwnershipIndexHydrator {
	readonly done: boolean;
	step(operationBudget?: number): number;
	finish(): RailModuleOwnershipIndex;
}

const EMPTY_RAIL_MODULE_OWNERSHIP_CANDIDATES: readonly RailModuleOwnership[] = Object.freeze([]);

interface RailModuleOwnershipIndexSourceBinding {
	readonly map: TileMap;
	readonly revision: number;
	readonly mutationGeneration: number;
}

const ownershipIndexSourceBindings = new WeakMap<object, RailModuleOwnershipIndexSourceBinding>();
const ownershipIndexHydrationSnapshots = new WeakMap<object, RailModuleOwnershipIndexSnapshot>();

/** True only while this exact index remains bound to the exact authored map generation. */
export function railModuleOwnershipIndexMatchesMap(
	index: RailModuleOwnershipIndex,
	map: TileMap,
): boolean {
	const binding = ownershipIndexSourceBindings.get(index);
	return (
		binding !== undefined &&
		binding.map === map &&
		binding.revision === map.getRevision() &&
		binding.mutationGeneration === map.getMutationGeneration() &&
		index.revision === binding.revision
	);
}

/**
 * Bind a hydrated startup index only after its exact transferred snapshot has passed the startup
 * fingerprint and semantic gates. Direct map compilation is bound internally and cannot be rebound.
 */
export function bindValidatedRailModuleOwnershipIndexSource(
	index: RailModuleOwnershipIndex,
	snapshot: RailModuleOwnershipIndexSnapshot,
	map: TileMap,
): void {
	if (ownershipIndexHydrationSnapshots.get(index) !== snapshot) {
		throw new Error("Rail module ownership index was not hydrated from this exact snapshot.");
	}
	if (ownershipIndexSourceBindings.has(index)) {
		throw new Error("Rail module ownership index already has an authored source.");
	}
	if (index.revision !== map.getRevision() || snapshot.revision !== map.getRevision()) {
		throw new Error("Rail module ownership index revision does not match its authored source.");
	}
	bindOwnershipIndexSource(index, map);
}

export function checksumRailModuleOwnershipSnapshot(
	snapshot: RailModuleOwnershipIndexSnapshot,
	authoredChecksum: string,
): string {
	const { checksum, keys, views } = createOwnershipSnapshotChecksum(snapshot, authoredChecksum);
	checksum.addStrings(keys);
	checksum.addViews(views);
	return checksum.digest();
}

export async function checksumRailModuleOwnershipSnapshotCooperatively(
	snapshot: RailModuleOwnershipIndexSnapshot,
	authoredChecksum: string,
	checkpoint: () => Promise<void>,
): Promise<string> {
	const { checksum, keys, views } = createOwnershipSnapshotChecksum(snapshot, authoredChecksum);
	await checksum.addStringsCooperatively(keys, checkpoint);
	await checksum.addViewsCooperatively(views, checkpoint);
	return checksum.digest();
}

function createOwnershipSnapshotChecksum(
	snapshot: RailModuleOwnershipIndexSnapshot,
	authoredChecksum: string,
): {
	readonly checksum: OrderedTypedChecksum;
	readonly keys: readonly string[];
	readonly views: readonly ArrayBufferView[];
} {
	const checksum = new OrderedTypedChecksum();
	const modules = snapshot.modules;
	checksum.addStrings([authoredChecksum]);
	checksum.addNumbers([snapshot.revision, modules.moduleCount]);
	return {
		checksum,
		keys: modules.keys,
		views: [
			modules.kinds,
			modules.advancedSwitchIds,
			modules.catalogIds,
			modules.grammars,
			modules.forwards,
			modules.spans,
			modules.sides,
			modules.advancedSwitchProfiles,
			modules.lengthMeters,
			modules.primaryOffsets,
			modules.primaryCells,
			modules.footprintOffsets,
			modules.footprintCells,
			modules.eraseOffsets,
			modules.eraseCells,
			modules.boundaryOffsets,
			modules.boundaryRoles,
			modules.boundaryCells,
			modules.boundaryDirections,
			snapshot.candidateCells,
			snapshot.candidateOffsets,
			snapshot.candidateModuleIndices,
		],
	};
}

const SNAPSHOT_MODULE_KINDS = [
	"straight",
	"turn",
	"u-turn",
	"shift",
	"turnout",
	"advanced-switch",
] as const satisfies readonly RailModuleKind[];
const SNAPSHOT_CATALOG_IDS = ["route", "u-turn", "shift", "advanced-switch"] as const;
const SNAPSHOT_GRAMMARS = [
	"straight-1-5m",
	"r500-turn",
	"directed-branch",
	"directed-merge",
	"u-turn",
	"shift",
	"advanced-switch",
] as const;
const SNAPSHOT_SPANS = [null, "compact", "wide"] as const;
const SNAPSHOT_SIDES = [null, "left", "right"] as const;
const SNAPSHOT_SWITCH_PROFILES = [null, "A", "B", "C", "D"] as const;

interface IndexedRailEntry {
	readonly cell: Cell;
	readonly rail: RailCell;
	readonly type: AuthoredRailType;
}

/** Build a revision-bound semantic module index from authored TileMap truth only. */
export function buildRailModuleOwnershipIndex(map: TileMap): RailModuleOwnershipIndex {
	const modules: RailModuleOwnership[] = [];
	const candidatesByCell = new Map<string, RailModuleOwnership[]>();
	const modulesByKey = new Map<string, RailModuleOwnership>();
	const advancedOwnedCells = new Set<string>();
	const claimedEdgeKeys = new Set<string>();
	const register = (module: RailModuleOwnership, aliases: readonly Cell[] = []): void => {
		modules.push(module);
		modulesByKey.set(module.key, module);
		for (const cell of [...module.primaryCells, ...aliases]) {
			const key = cellKey(cell.x, cell.y);
			const existing = candidatesByCell.get(key) ?? [];
			if (!existing.some((candidate) => candidate.key === module.key)) existing.push(module);
			candidatesByCell.set(key, existing);
		}
	};
	const claim = (module: RailModuleOwnership): void => {
		for (const edge of module.eraseEdges) claimedEdgeKeys.add(directedEdgeKey(edge));
	};

	map.forEachAdvancedSwitch((record) => {
		const geometry = deriveAdvancedSwitchGeometry(record);
		for (const cell of geometry.claimedCells) advancedOwnedCells.add(cellKey(cell.x, cell.y));
		const owned = advancedSwitchModule(map.getRevision(), record);
		register(owned, geometry.claimedCells);
		claim(owned);
	});

	const entries = new Map<string, IndexedRailEntry>();
	map.forEachRail((x, y, rail) => {
		const key = cellKey(x, y);
		if (advancedOwnedCells.has(key)) return;
		entries.set(key, { cell: { x, y }, rail, type: classifyRailCell(rail) });
	});

	for (const footprint of collectTurnoutFootprints(map)) {
		if (advancedOwnedCells.has(cellKey(footprint.cell.x, footprint.cell.y))) continue;
		const owned = turnoutModule(map.getRevision(), footprint);
		register(owned, footprint.reservedCells);
		claim(owned);
	}

	const compoundIndex = new Map<string, CompoundRailEntry>();
	for (const [key, entry] of entries) {
		if (entry.type === "LINEAR" || entry.type === "LEFT_CURVE" || entry.type === "RIGHT_CURVE") {
			compoundIndex.set(key, { cell: entry.cell, rail: entry.rail, type: entry.type });
		}
	}
	const consumed = new Set<string>();
	for (const pattern of collectCompoundRailPatterns(compoundIndex)) {
		for (const cell of pattern.cells) consumed.add(cellKey(cell.x, cell.y));
		const module = compoundModule(map.getRevision(), pattern);
		register(module, terminalBoundaryAliases(entries, module));
		claim(module);
	}

	for (const entry of entries.values()) {
		if (
			consumed.has(cellKey(entry.cell.x, entry.cell.y)) ||
			(entry.type !== "LEFT_CURVE" && entry.type !== "RIGHT_CURVE")
		) {
			continue;
		}
		consumed.add(cellKey(entry.cell.x, entry.cell.y));
		const module = turnModule(map.getRevision(), entry);
		register(module, terminalBoundaryAliases(entries, module));
		claim(module);
	}

	for (const module of straightModules(map.getRevision(), entries, claimedEdgeKeys))
		register(module);

	modules.sort(compareModules);
	for (const candidates of candidatesByCell.values()) {
		candidates.sort((left, right) => ownershipPriority(left) - ownershipPriority(right));
		Object.freeze(candidates);
	}
	const index = createOwnershipIndex(
		map.getRevision(),
		Object.freeze(modules),
		candidatesByCell,
		modulesByKey,
	);
	bindOwnershipIndexSource(index, map);
	return index;
}

/** Rebuild lookup maps in bounded steps after a startup Worker transfers derived module data. */
export function createRailModuleOwnershipIndexHydrator(
	snapshot: RailModuleOwnershipIndexSnapshot,
): RailModuleOwnershipIndexHydrator {
	validateOwnershipSnapshotShape(snapshot);
	return createValidatedRailModuleOwnershipIndexHydrator(snapshot);
}

/** Validate transferred CSR storage in bounded steps before rebuilding its lookup maps. */
export async function createRailModuleOwnershipIndexHydratorCooperatively(
	snapshot: RailModuleOwnershipIndexSnapshot,
	checkpoint: () => Promise<void>,
	operationBudget = 1_024,
): Promise<RailModuleOwnershipIndexHydrator> {
	if (!Number.isSafeInteger(operationBudget) || operationBudget <= 0) {
		throw new Error("Ownership validation operation budget must be a positive safe integer.");
	}
	let operations = 0;
	for (const _step of ownershipSnapshotShapeValidationSteps(snapshot)) {
		void _step;
		operations++;
		if (operations < operationBudget) continue;
		await checkpoint();
		operations = 0;
	}
	if (operations > 0) await checkpoint();
	return createValidatedRailModuleOwnershipIndexHydrator(snapshot);
}

function createValidatedRailModuleOwnershipIndexHydrator(
	snapshot: RailModuleOwnershipIndexSnapshot,
): RailModuleOwnershipIndexHydrator {
	const modules = new Array<RailModuleOwnership>(snapshot.modules.moduleCount);
	const modulesByKey = new Map<string, RailModuleOwnership>();
	const candidatesByCell = new Map<string, RailModuleOwnership[]>();
	let moduleIndex = 0;
	let candidateCellIndex = 0;
	let done = false;
	return {
		get done(): boolean {
			return done;
		},
		step(operationBudget = 1_024): number {
			if (done) return 0;
			if (!Number.isSafeInteger(operationBudget) || operationBudget <= 0) {
				throw new Error("Ownership hydration operation budget must be a positive safe integer.");
			}
			let operations = 0;
			while (moduleIndex < snapshot.modules.moduleCount && operations < operationBudget) {
				const owned = decodeOwnershipModule(snapshot.revision, snapshot.modules, moduleIndex);
				if (modulesByKey.has(owned.key)) {
					throw new Error(`Ownership snapshot contains duplicate module key ${owned.key}.`);
				}
				modules[moduleIndex] = owned;
				modulesByKey.set(owned.key, owned);
				moduleIndex++;
				operations++;
			}
			const candidateCellCount = snapshot.candidateOffsets.length - 1;
			while (candidateCellIndex < candidateCellCount && operations < operationBudget) {
				const cellOffset = candidateCellIndex * 2;
				const x = snapshot.candidateCells[cellOffset] as number;
				const y = snapshot.candidateCells[cellOffset + 1] as number;
				const start = snapshot.candidateOffsets[candidateCellIndex] as number;
				const end = snapshot.candidateOffsets[candidateCellIndex + 1] as number;
				const candidates: RailModuleOwnership[] = [];
				for (let index = start; index < end; index++) {
					const ownedIndex = snapshot.candidateModuleIndices[index] as number;
					const owned = modules[ownedIndex];
					if (!owned)
						throw new Error(`Ownership candidate references missing module ${ownedIndex}.`);
					candidates.push(owned);
				}
				const key = cellKey(x, y);
				if (candidatesByCell.has(key)) {
					throw new Error(`Ownership snapshot contains duplicate candidate cell ${key}.`);
				}
				candidatesByCell.set(key, candidates);
				Object.freeze(candidates);
				candidateCellIndex++;
				operations++;
			}
			done =
				moduleIndex === snapshot.modules.moduleCount && candidateCellIndex === candidateCellCount;
			return operations;
		},
		finish(): RailModuleOwnershipIndex {
			if (!done) throw new Error("Ownership index hydration is not complete.");
			const index = createOwnershipIndex(
				snapshot.revision,
				Object.freeze(modules),
				candidatesByCell,
				modulesByKey,
			);
			ownershipIndexHydrationSnapshots.set(index, snapshot);
			return index;
		},
	};
}

function bindOwnershipIndexSource(index: RailModuleOwnershipIndex, map: TileMap): void {
	ownershipIndexSourceBindings.set(
		index,
		Object.freeze({
			map,
			revision: map.getRevision(),
			mutationGeneration: map.getMutationGeneration(),
		}),
	);
}

function createOwnershipIndex(
	revision: number,
	modules: readonly RailModuleOwnership[],
	candidatesByCell: ReadonlyMap<string, readonly RailModuleOwnership[]>,
	modulesByKey: ReadonlyMap<string, RailModuleOwnership>,
): RailModuleOwnershipIndex {
	return Object.freeze({
		revision,
		modules,
		candidates(cell: Cell): readonly RailModuleOwnership[] {
			return (
				candidatesByCell.get(cellKey(cell.x, cell.y)) ?? EMPTY_RAIL_MODULE_OWNERSHIP_CANDIDATES
			);
		},
		resolve(cell: Cell, routeHint?: RailRouteHint): RailModuleOwnershipResolution {
			const candidates = candidatesByCell.get(cellKey(cell.x, cell.y)) ?? [];
			if (candidates.length === 0) {
				return Object.freeze({
					status: "none",
					reason: "선택한 위치에 유효한 레일 모듈이 없습니다",
				});
			}
			if (candidates.length === 1) {
				return Object.freeze({ status: "resolved", module: candidates[0] as RailModuleOwnership });
			}
			if (routeHint) {
				const roleMatches = candidates.filter((candidate) =>
					routeHint.role === "turnout-diverge"
						? candidate.kind === "turnout"
						: routeHint.role === "through"
							? candidate.kind !== "turnout"
							: true,
				);
				if (roleMatches.length === 1) {
					return Object.freeze({
						status: "resolved",
						module: roleMatches[0] as RailModuleOwnership,
					});
				}
				const hinted = candidates.filter((candidate) =>
					moduleMatchesRoute(candidate, cell, routeHint),
				);
				if (hinted.length === 1) {
					return Object.freeze({ status: "resolved", module: hinted[0] as RailModuleOwnership });
				}
			}
			return Object.freeze({
				status: "ambiguous",
				candidates: Object.freeze([...candidates]),
				reason: "한 셀에 여러 물리 경로가 있습니다. 선택할 경로 가까이에서 다시 클릭하세요",
			});
		},
		find(key: string): RailModuleOwnership | null {
			return modulesByKey.get(key) ?? null;
		},
		captureSnapshot(): RailModuleOwnershipIndexSnapshot {
			return captureOwnershipSnapshot(revision, modules, candidatesByCell, modulesByKey);
		},
	});
}

function captureOwnershipSnapshot(
	revision: number,
	modules: readonly RailModuleOwnership[],
	candidatesByCell: ReadonlyMap<string, readonly RailModuleOwnership[]>,
	modulesByKey: ReadonlyMap<string, RailModuleOwnership>,
): RailModuleOwnershipIndexSnapshot {
	const moduleSnapshot = encodeOwnershipModules(modules);
	const moduleIndexByKey = new Map<string, number>();
	for (let index = 0; index < modules.length; index++) {
		const key = (modules[index] as RailModuleOwnership).key;
		if (moduleIndexByKey.has(key) || modulesByKey.get(key) !== modules[index]) {
			throw new Error(`Ownership module key ${key} is not uniquely indexed.`);
		}
		moduleIndexByKey.set(key, index);
	}
	const entries = [...candidatesByCell].map(([key, candidates]) => {
		const comma = key.indexOf(",");
		const x = Number(key.slice(0, comma));
		const y = Number(key.slice(comma + 1));
		return { x, y, candidates };
	});
	entries.sort((left, right) => left.y - right.y || left.x - right.x);
	const candidateCells = new Int32Array(entries.length * 2);
	const candidateOffsets = new Uint32Array(entries.length + 1);
	let candidateCount = 0;
	for (let index = 0; index < entries.length; index++) {
		const entry = entries[index] as (typeof entries)[number];
		candidateCells[index * 2] = entry.x;
		candidateCells[index * 2 + 1] = entry.y;
		candidateOffsets[index] = candidateCount;
		candidateCount += entry.candidates.length;
	}
	candidateOffsets[entries.length] = candidateCount;
	const candidateModuleIndices = new Uint32Array(candidateCount);
	let writeIndex = 0;
	for (const entry of entries) {
		for (const candidate of entry.candidates) {
			const moduleIndex = moduleIndexByKey.get(candidate.key);
			if (moduleIndex === undefined) {
				throw new Error(`Ownership candidate ${candidate.key} is not a registered module.`);
			}
			candidateModuleIndices[writeIndex++] = moduleIndex;
		}
	}
	return Object.freeze({
		revision,
		modules: moduleSnapshot,
		candidateCells,
		candidateOffsets,
		candidateModuleIndices,
	});
}

function encodeOwnershipModules(
	modules: readonly RailModuleOwnership[],
): RailModuleOwnershipModulesSnapshot {
	const moduleCount = modules.length;
	const keys = new Array<string>(moduleCount);
	const kinds = new Uint8Array(moduleCount);
	const advancedSwitchIds = new Int32Array(moduleCount);
	const catalogIds = new Uint8Array(moduleCount);
	const grammars = new Uint8Array(moduleCount);
	const forwards = new Uint8Array(moduleCount);
	const spans = new Uint8Array(moduleCount);
	const sides = new Uint8Array(moduleCount);
	const advancedSwitchProfiles = new Uint8Array(moduleCount);
	const lengthMeters = new Float64Array(moduleCount);
	const primaryOffsets = new Uint32Array(moduleCount + 1);
	const footprintOffsets = new Uint32Array(moduleCount + 1);
	const eraseOffsets = new Uint32Array(moduleCount + 1);
	const boundaryOffsets = new Uint32Array(moduleCount + 1);
	let primaryCount = 0;
	let footprintCount = 0;
	let eraseCount = 0;
	let boundaryCount = 0;
	for (let index = 0; index < moduleCount; index++) {
		const owned = modules[index] as RailModuleOwnership;
		primaryOffsets[index] = primaryCount;
		footprintOffsets[index] = footprintCount;
		eraseOffsets[index] = eraseCount;
		boundaryOffsets[index] = boundaryCount;
		primaryCount += owned.primaryCells.length;
		footprintCount += owned.footprintCells.length;
		eraseCount += owned.eraseEdges.length;
		boundaryCount += owned.boundaries.length;
	}
	primaryOffsets[moduleCount] = primaryCount;
	footprintOffsets[moduleCount] = footprintCount;
	eraseOffsets[moduleCount] = eraseCount;
	boundaryOffsets[moduleCount] = boundaryCount;
	const primaryCells = new Int32Array(primaryCount * 2);
	const footprintCells = new Int32Array(footprintCount * 2);
	const eraseCells = new Int32Array(eraseCount * 4);
	const boundaryRoles = new Uint8Array(boundaryCount);
	const boundaryCells = new Int32Array(boundaryCount * 2);
	const boundaryDirections = new Uint8Array(boundaryCount);
	let primaryWrite = 0;
	let footprintWrite = 0;
	let eraseWrite = 0;
	let boundaryWrite = 0;
	for (let index = 0; index < moduleCount; index++) {
		const owned = modules[index] as RailModuleOwnership;
		keys[index] = owned.key;
		kinds[index] = encodeSnapshotEnum(SNAPSHOT_MODULE_KINDS, owned.kind, "module kind");
		advancedSwitchIds[index] = owned.advancedSwitchId ?? -1;
		catalogIds[index] = encodeSnapshotEnum(
			SNAPSHOT_CATALOG_IDS,
			owned.construction.catalogId,
			"catalog id",
		);
		grammars[index] = encodeSnapshotEnum(
			SNAPSHOT_GRAMMARS,
			owned.construction.grammar,
			"construction grammar",
		);
		forwards[index] = owned.construction.forward;
		spans[index] = encodeSnapshotEnum(SNAPSHOT_SPANS, owned.construction.span, "module span");
		sides[index] = encodeSnapshotEnum(SNAPSHOT_SIDES, owned.construction.side, "module side");
		advancedSwitchProfiles[index] = encodeSnapshotEnum(
			SNAPSHOT_SWITCH_PROFILES,
			owned.construction.advancedSwitchProfile,
			"advanced switch profile",
		);
		lengthMeters[index] = owned.construction.lengthMeters ?? Number.NaN;
		for (const cell of owned.primaryCells)
			primaryWrite = writeSnapshotCell(primaryCells, primaryWrite, cell);
		for (const cell of owned.footprintCells) {
			footprintWrite = writeSnapshotCell(footprintCells, footprintWrite, cell);
		}
		for (const edge of owned.eraseEdges) {
			eraseWrite = writeSnapshotCell(eraseCells, eraseWrite, edge.from);
			eraseWrite = writeSnapshotCell(eraseCells, eraseWrite, edge.to);
		}
		for (const boundary of owned.boundaries) {
			boundaryRoles[boundaryWrite] = boundary.role === "input" ? 0 : 1;
			writeSnapshotCell(boundaryCells, boundaryWrite * 2, boundary.cell);
			boundaryDirections[boundaryWrite] = boundary.direction;
			boundaryWrite++;
		}
	}
	return Object.freeze({
		moduleCount,
		keys: Object.freeze(keys),
		kinds,
		advancedSwitchIds,
		catalogIds,
		grammars,
		forwards,
		spans,
		sides,
		advancedSwitchProfiles,
		lengthMeters,
		primaryOffsets,
		primaryCells,
		footprintOffsets,
		footprintCells,
		eraseOffsets,
		eraseCells,
		boundaryOffsets,
		boundaryRoles,
		boundaryCells,
		boundaryDirections,
	});
}

function decodeOwnershipModule(
	revision: number,
	snapshot: RailModuleOwnershipModulesSnapshot,
	index: number,
): RailModuleOwnership {
	const key = snapshot.keys[index];
	if (typeof key !== "string" || key.length === 0) {
		throw new Error(`Ownership module ${index} key is invalid.`);
	}
	const forward = snapshot.forwards[index] as Direction;
	if (!ALL_DIRECTIONS.includes(forward)) {
		throw new Error(`Ownership module ${key} forward direction is invalid.`);
	}
	const advancedSwitchId = snapshot.advancedSwitchIds[index] as number;
	if (
		advancedSwitchId !== -1 &&
		(!Number.isSafeInteger(advancedSwitchId) || advancedSwitchId <= 0)
	) {
		throw new Error(`Ownership module ${key} advanced switch id is invalid.`);
	}
	const length = snapshot.lengthMeters[index] as number;
	if (!Number.isNaN(length) && (!Number.isFinite(length) || length < 0)) {
		throw new Error(`Ownership module ${key} length is invalid.`);
	}
	return Object.freeze({
		revision,
		key,
		kind: decodeSnapshotEnum(SNAPSHOT_MODULE_KINDS, snapshot.kinds[index], key),
		primaryCells: decodeSnapshotCells(
			snapshot.primaryCells,
			snapshot.primaryOffsets[index] as number,
			snapshot.primaryOffsets[index + 1] as number,
		),
		footprintCells: decodeSnapshotCells(
			snapshot.footprintCells,
			snapshot.footprintOffsets[index] as number,
			snapshot.footprintOffsets[index + 1] as number,
		),
		eraseEdges: decodeSnapshotEdges(
			snapshot.eraseCells,
			snapshot.eraseOffsets[index] as number,
			snapshot.eraseOffsets[index + 1] as number,
		),
		boundaries: decodeSnapshotBoundaries(
			snapshot,
			snapshot.boundaryOffsets[index] as number,
			snapshot.boundaryOffsets[index + 1] as number,
		),
		construction: Object.freeze({
			catalogId: decodeSnapshotEnum(SNAPSHOT_CATALOG_IDS, snapshot.catalogIds[index], key),
			grammar: decodeSnapshotEnum(SNAPSHOT_GRAMMARS, snapshot.grammars[index], key),
			forward,
			span: decodeSnapshotEnum(SNAPSHOT_SPANS, snapshot.spans[index], key),
			side: decodeSnapshotEnum(SNAPSHOT_SIDES, snapshot.sides[index], key),
			advancedSwitchProfile: decodeSnapshotEnum(
				SNAPSHOT_SWITCH_PROFILES,
				snapshot.advancedSwitchProfiles[index],
				key,
			),
			lengthMeters: Number.isNaN(length) ? null : length,
		}),
		advancedSwitchId: advancedSwitchId === -1 ? null : advancedSwitchId,
	});
}

function writeSnapshotCell(target: Int32Array, offset: number, cell: Cell): number {
	target[offset] = cell.x;
	target[offset + 1] = cell.y;
	return offset + 2;
}

function decodeSnapshotCells(target: Int32Array, start: number, end: number): readonly Cell[] {
	const cells = new Array<Cell>(end - start);
	for (let index = start; index < end; index++) {
		cells[index - start] = Object.freeze({
			x: target[index * 2] as number,
			y: target[index * 2 + 1] as number,
		});
	}
	return Object.freeze(cells);
}

function decodeSnapshotEdges(
	target: Int32Array,
	start: number,
	end: number,
): readonly DirectedRailEdge[] {
	const edges = new Array<DirectedRailEdge>(end - start);
	for (let index = start; index < end; index++) {
		const offset = index * 4;
		edges[index - start] = Object.freeze({
			from: Object.freeze({ x: target[offset] as number, y: target[offset + 1] as number }),
			to: Object.freeze({ x: target[offset + 2] as number, y: target[offset + 3] as number }),
		});
	}
	return Object.freeze(edges);
}

function decodeSnapshotBoundaries(
	snapshot: RailModuleOwnershipModulesSnapshot,
	start: number,
	end: number,
): readonly RailModuleBoundary[] {
	const boundaries = new Array<RailModuleBoundary>(end - start);
	for (let index = start; index < end; index++) {
		const direction = snapshot.boundaryDirections[index] as Direction;
		if (!ALL_DIRECTIONS.includes(direction)) {
			throw new Error(`Ownership boundary ${index} direction is invalid.`);
		}
		const role = snapshot.boundaryRoles[index] as number;
		if (role > 1) throw new Error(`Ownership boundary ${index} role is invalid.`);
		boundaries[index - start] = Object.freeze({
			role: role === 0 ? "input" : "output",
			cell: Object.freeze({
				x: snapshot.boundaryCells[index * 2] as number,
				y: snapshot.boundaryCells[index * 2 + 1] as number,
			}),
			direction,
		});
	}
	return Object.freeze(boundaries);
}

function encodeSnapshotEnum(values: readonly unknown[], value: unknown, label: string): number {
	const index = values.indexOf(value);
	if (index < 0) throw new Error(`Unsupported ownership snapshot ${label} ${String(value)}.`);
	return index;
}

function decodeSnapshotEnum<const Values extends readonly unknown[]>(
	values: Values,
	encoded: number | undefined,
	moduleKey: string,
): Values[number] {
	if (encoded === undefined || encoded >= values.length) {
		throw new Error(`Ownership module ${moduleKey} contains an invalid enum value.`);
	}
	return values[encoded] as Values[number];
}

function validateOwnershipSnapshotShape(snapshot: RailModuleOwnershipIndexSnapshot): void {
	for (const _step of ownershipSnapshotShapeValidationSteps(snapshot)) void _step;
}

function* ownershipSnapshotShapeValidationSteps(
	snapshot: RailModuleOwnershipIndexSnapshot,
): Generator<void> {
	if (!Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0) {
		throw new Error("Ownership snapshot revision must be a non-negative safe integer.");
	}
	if (
		!(snapshot.candidateCells instanceof Int32Array) ||
		!(snapshot.candidateOffsets instanceof Uint32Array) ||
		!(snapshot.candidateModuleIndices instanceof Uint32Array)
	) {
		throw new Error("Ownership snapshot candidate storage types are malformed.");
	}
	yield* ownershipModuleSnapshotShapeValidationSteps(snapshot.modules);
	if (snapshot.candidateOffsets.length === 0 || snapshot.candidateOffsets[0] !== 0) {
		throw new Error("Ownership snapshot candidate offsets must start at zero.");
	}
	const candidateCellCount = snapshot.candidateOffsets.length - 1;
	if (snapshot.candidateCells.length !== candidateCellCount * 2) {
		throw new Error("Ownership snapshot candidate cell coordinates do not match its offsets.");
	}
	let previous = 0;
	for (const offset of snapshot.candidateOffsets) {
		if (offset < previous || offset > snapshot.candidateModuleIndices.length) {
			throw new Error("Ownership snapshot candidate offsets are not monotonic.");
		}
		previous = offset;
		yield;
	}
	if (previous !== snapshot.candidateModuleIndices.length) {
		throw new Error("Ownership snapshot candidate offsets do not cover every module reference.");
	}
	for (const moduleIndex of snapshot.candidateModuleIndices) {
		if (moduleIndex >= snapshot.modules.moduleCount) {
			throw new Error(`Ownership snapshot references missing module ${moduleIndex}.`);
		}
		yield;
	}
}

function* ownershipModuleSnapshotShapeValidationSteps(
	snapshot: RailModuleOwnershipModulesSnapshot,
): Generator<void> {
	const count = snapshot.moduleCount;
	const scalarColumns: readonly ArrayLike<unknown>[] = [
		snapshot.keys,
		snapshot.kinds,
		snapshot.advancedSwitchIds,
		snapshot.catalogIds,
		snapshot.grammars,
		snapshot.forwards,
		snapshot.spans,
		snapshot.sides,
		snapshot.advancedSwitchProfiles,
		snapshot.lengthMeters,
	];
	if (
		!Number.isSafeInteger(count) ||
		count < 0 ||
		scalarColumns.some((column) => column.length !== count) ||
		!(snapshot.kinds instanceof Uint8Array) ||
		!(snapshot.advancedSwitchIds instanceof Int32Array) ||
		!(snapshot.catalogIds instanceof Uint8Array) ||
		!(snapshot.grammars instanceof Uint8Array) ||
		!(snapshot.forwards instanceof Uint8Array) ||
		!(snapshot.spans instanceof Uint8Array) ||
		!(snapshot.sides instanceof Uint8Array) ||
		!(snapshot.advancedSwitchProfiles instanceof Uint8Array) ||
		!(snapshot.lengthMeters instanceof Float64Array) ||
		!(snapshot.primaryOffsets instanceof Uint32Array) ||
		!(snapshot.primaryCells instanceof Int32Array) ||
		!(snapshot.footprintOffsets instanceof Uint32Array) ||
		!(snapshot.footprintCells instanceof Int32Array) ||
		!(snapshot.eraseOffsets instanceof Uint32Array) ||
		!(snapshot.eraseCells instanceof Int32Array) ||
		!(snapshot.boundaryOffsets instanceof Uint32Array) ||
		!(snapshot.boundaryRoles instanceof Uint8Array) ||
		!(snapshot.boundaryCells instanceof Int32Array) ||
		!(snapshot.boundaryDirections instanceof Uint8Array)
	) {
		throw new Error("Ownership module snapshot columns are malformed.");
	}
	yield* ownershipOffsetValidationSteps(
		snapshot.primaryOffsets,
		count,
		snapshot.primaryCells.length,
		2,
	);
	yield* ownershipOffsetValidationSteps(
		snapshot.footprintOffsets,
		count,
		snapshot.footprintCells.length,
		2,
	);
	yield* ownershipOffsetValidationSteps(
		snapshot.eraseOffsets,
		count,
		snapshot.eraseCells.length,
		4,
	);
	yield* ownershipOffsetValidationSteps(
		snapshot.boundaryOffsets,
		count,
		snapshot.boundaryCells.length,
		2,
	);
	const boundaryCount = snapshot.boundaryOffsets[count] as number;
	if (
		snapshot.boundaryRoles.length !== boundaryCount ||
		snapshot.boundaryDirections.length !== boundaryCount
	) {
		throw new Error("Ownership module boundary columns are malformed.");
	}
}

function* ownershipOffsetValidationSteps(
	offsets: Uint32Array,
	moduleCount: number,
	valueLength: number,
	valueWidth: number,
): Generator<void> {
	if (offsets.length !== moduleCount + 1 || offsets[0] !== 0) {
		throw new Error("Ownership module CSR offsets are malformed.");
	}
	let previous = 0;
	for (const offset of offsets) {
		if (offset < previous || offset * valueWidth > valueLength) {
			throw new Error("Ownership module CSR offsets are malformed.");
		}
		previous = offset;
		yield;
	}
	if (previous * valueWidth !== valueLength) {
		throw new Error("Ownership module CSR offsets do not cover their values.");
	}
}

export function resolveRailModuleOwnership(
	index: RailModuleOwnershipIndex,
	cell: Cell,
	routeHint?: RailRouteHint,
): RailModuleOwnershipResolution {
	return index.resolve(cell, routeHint);
}

/** Remove only the directed adjacency owned by the current semantic module. */
export function planRailModuleBulldoze(map: TileMap, module: RailModuleOwnership): RailErasePlan {
	if (module.revision !== map.getRevision()) {
		return invalidBulldoze(
			map,
			module.footprintCells,
			"선택한 모듈이 오래되어 다시 선택해야 합니다",
		);
	}
	const current = buildRailModuleOwnershipIndex(map).find(module.key);
	if (!current || !sameEdgeSet(current.eraseEdges, module.eraseEdges)) {
		return invalidBulldoze(
			map,
			module.footprintCells,
			"레일 토폴로지가 변경되어 모듈 소유권이 만료되었습니다",
		);
	}
	if (current.advancedSwitchId !== null) {
		const record = map.getAdvancedSwitch(current.advancedSwitchId);
		return record
			? planRailErase(map, [record.origin])
			: invalidBulldoze(map, current.footprintCells, "스위치 소유권을 찾을 수 없습니다");
	}
	return planDirectedEdgeErase(map, current.eraseEdges, current.footprintCells);
}

function advancedSwitchModule(revision: number, record: AdvancedSwitchRecord): RailModuleOwnership {
	const geometry = deriveAdvancedSwitchGeometry(record);
	return module({
		revision,
		key: `SW-${record.id}`,
		kind: "advanced-switch",
		primaryCells: geometry.claimedCells,
		footprintCells: geometry.claimedCells,
		eraseEdges: uniqueEdges(geometry.routes.flatMap(edgesFromPath)),
		boundaries: geometry.ports,
		construction: {
			catalogId: "advanced-switch",
			grammar: "advanced-switch",
			forward: record.forward,
			span: null,
			side: sideFor(record.forward, record.lateral),
			advancedSwitchProfile: record.profileClass,
			lengthMeters: null,
		},
		advancedSwitchId: record.id,
	});
}

function turnoutModule(revision: number, footprint: TurnoutFootprint): RailModuleOwnership {
	const branch = footprint.kind === TURNOUT_KIND.BRANCH;
	const sideCell = moveCell(footprint.cell, footprint.divergingSide);
	const edge = branch
		? { from: footprint.cell, to: sideCell }
		: { from: sideCell, to: footprint.cell };
	return module({
		revision,
		key: footprint.id,
		kind: "turnout",
		primaryCells: [footprint.cell],
		footprintCells: footprint.reservedCells,
		eraseEdges: [edge],
		boundaries: boundariesFromEdges([edge]),
		construction: {
			catalogId: "route",
			grammar: branch ? "directed-branch" : "directed-merge",
			forward: footprint.through.outgoing,
			span: null,
			side: sideFor(footprint.through.outgoing, footprint.divergingSide),
			advancedSwitchProfile: null,
			lengthMeters: null,
		},
		advancedSwitchId: null,
	});
}

function compoundModule(revision: number, pattern: CompoundRailPattern): RailModuleOwnership {
	const entry = moveCell(pattern.from, oppositeDirection(pattern.fromDirection));
	const exit = moveCell(pattern.to, pattern.toDirection);
	const edges = edgesFromPath([entry, ...pattern.cells, exit]);
	const uTurn = pattern.type === "CCW_CURVE" || pattern.type === "CSC_CURVE_HOMO";
	const wide = pattern.type === "CSC_CURVE_HOMO" || pattern.type === "CSC_CURVE_HETE";
	return module({
		revision,
		key: `${pattern.type}:${cellKey(pattern.from.x, pattern.from.y)}`,
		kind: uTurn ? "u-turn" : "shift",
		primaryCells: pattern.cells,
		footprintCells: pattern.cells,
		eraseEdges: edges,
		boundaries: boundariesFromEdges(edges),
		construction: {
			catalogId: uTurn ? "u-turn" : "shift",
			grammar: uTurn ? "u-turn" : "shift",
			forward: pattern.fromDirection,
			span: wide ? "wide" : "compact",
			side: pattern.turn,
			advancedSwitchProfile: null,
			lengthMeters: null,
		},
		advancedSwitchId: null,
	});
}

function turnModule(revision: number, entry: IndexedRailEntry): RailModuleOwnership {
	const incoming = singleDirection(entry.rail.incoming) as Direction;
	const outgoing = singleDirection(entry.rail.outgoing) as Direction;
	const previous = moveCell(entry.cell, incoming);
	const next = moveCell(entry.cell, outgoing);
	const edges = edgesFromPath([previous, entry.cell, next]);
	return module({
		revision,
		key: `${entry.type}:${cellKey(entry.cell.x, entry.cell.y)}`,
		kind: "turn",
		primaryCells: [entry.cell],
		footprintCells: [entry.cell],
		eraseEdges: edges,
		boundaries: boundariesFromEdges(edges),
		construction: {
			catalogId: "route",
			grammar: "r500-turn",
			forward: oppositeDirection(incoming),
			span: null,
			side: entry.type === "LEFT_CURVE" ? "left" : "right",
			advancedSwitchProfile: null,
			lengthMeters: 1,
		},
		advancedSwitchId: null,
	});
}

function straightModules(
	revision: number,
	entries: ReadonlyMap<string, IndexedRailEntry>,
	claimedEdgeKeys: ReadonlySet<string>,
): RailModuleOwnership[] {
	const eligible = new Map<string, DirectedRailEdge>();
	for (const entry of entries.values()) {
		if (entry.type === "INVALID") continue;
		for (const direction of ALL_DIRECTIONS) {
			if ((entry.rail.outgoing & direction) === 0) continue;
			const to = moveCell(entry.cell, direction);
			const neighbor = entries.get(cellKey(to.x, to.y));
			if (
				!neighbor ||
				neighbor.type === "INVALID" ||
				(neighbor.rail.incoming & oppositeDirection(direction)) === 0
			) {
				continue;
			}
			const edge = { from: entry.cell, to };
			const key = directedEdgeKey(edge);
			if (!claimedEdgeKeys.has(key)) eligible.set(key, edge);
		}
	}
	const ordered = [...eligible.values()].sort(compareEdges);
	const byStart = new Map(ordered.map((edge) => [directedEdgeStartKey(edge), edge] as const));
	const visited = new Set<string>();
	const chains: DirectedRailEdge[][] = [];
	const walk = (start: DirectedRailEdge): void => {
		const chain: DirectedRailEdge[] = [];
		let current: DirectedRailEdge | undefined = start;
		while (current && !visited.has(directedEdgeKey(current))) {
			const direction = directionBetween(current.from, current.to);
			if (!direction) break;
			visited.add(directedEdgeKey(current));
			chain.push(current);
			current = byStart.get(`${cellKey(current.to.x, current.to.y)}:${direction}`);
		}
		if (chain.length > 0) chains.push(chain);
	};
	for (const edge of ordered.filter(
		(candidate) => !hasStraightEdgePredecessor(byStart, candidate),
	)) {
		walk(edge);
	}
	for (const edge of ordered) walk(edge);

	const modules: RailModuleOwnership[] = [];
	for (const chain of chains) {
		for (let offset = 0; offset < chain.length; offset += 5) {
			const chunk = chain.slice(offset, offset + 5);
			const first = chunk[0] as DirectedRailEdge;
			const last = chunk.at(-1) as DirectedRailEdge;
			const path = [first.from, ...chunk.map((edge) => edge.to)];
			const finalChunk = offset + chunk.length === chain.length;
			modules.push(
				module({
					revision,
					key: `LINEAR_EDGE:${directedEdgeKey(first)}`,
					kind: "straight",
					primaryCells: [...chunk.map((edge) => edge.from), ...(finalChunk ? [last.to] : [])],
					footprintCells: path,
					eraseEdges: chunk,
					boundaries: boundariesFromEdges(chunk),
					construction: {
						catalogId: "route",
						grammar: "straight-1-5m",
						forward: directionBetween(first.from, first.to) as Direction,
						span: null,
						side: null,
						advancedSwitchProfile: null,
						lengthMeters: chunk.length,
					},
					advancedSwitchId: null,
				}),
			);
		}
	}
	return modules;
}

function terminalBoundaryAliases(
	entries: ReadonlyMap<string, IndexedRailEntry>,
	module: RailModuleOwnership,
): Cell[] {
	const aliases: Cell[] = [];
	for (const boundary of module.boundaries) {
		const entry = entries.get(cellKey(boundary.cell.x, boundary.cell.y));
		if (entry?.type === "TERMINAL") aliases.push(boundary.cell);
	}
	return aliases;
}

function planDirectedEdgeErase(
	map: TileMap,
	edges: readonly DirectedRailEdge[],
	footprintCells: readonly Cell[],
): RailErasePlan {
	const overlay = new Map<string, RailMutation>();
	const read = (cell: Cell): number =>
		overlay.get(cellKey(cell.x, cell.y))?.after ?? map.getEncoded(cell.x, cell.y);
	const write = (cell: Cell, after: number): void => {
		const key = cellKey(cell.x, cell.y);
		const existing = overlay.get(key);
		overlay.set(key, {
			x: cell.x,
			y: cell.y,
			before: existing?.before ?? map.getEncoded(cell.x, cell.y),
			after,
		});
	};
	for (const edge of edges) {
		const direction = directionBetween(edge.from, edge.to);
		if (!direction)
			return invalidBulldoze(map, footprintCells, "모듈 소유 edge가 인접하지 않습니다");
		const opposite = oppositeDirection(direction);
		const from = decodeRailCell(read(edge.from));
		const to = decodeRailCell(read(edge.to));
		if ((from.outgoing & direction) === 0 || (to.incoming & opposite) === 0) {
			return invalidBulldoze(map, footprintCells, "모듈 소유 edge가 현재 레일과 일치하지 않습니다");
		}
		write(edge.from, encodeRailCell({ ...from, outgoing: from.outgoing & ~direction }));
		write(edge.to, encodeRailCell({ ...to, incoming: to.incoming & ~opposite }));
	}
	const mutations = [...overlay.values()].filter((mutation) => mutation.before !== mutation.after);
	const topologyError = railMutationTopologyError(map, mutations);
	return {
		kind: "erase",
		baseRevision: map.getRevision(),
		cells: freezeCells(footprintCells),
		mutations,
		switchMutations: [],
		valid: mutations.length > 0 && topologyError === null,
		reason:
			topologyError ??
			(mutations.length > 0
				? "선택한 semantic module의 directed edge 철거"
				: "철거할 edge가 없습니다"),
	};
}

function invalidBulldoze(map: TileMap, cells: readonly Cell[], reason: string): RailErasePlan {
	return {
		kind: "erase",
		baseRevision: map.getRevision(),
		cells: freezeCells(cells),
		mutations: [],
		switchMutations: [],
		valid: false,
		reason,
	};
}

function module(value: RailModuleOwnership): RailModuleOwnership {
	return Object.freeze({
		...value,
		primaryCells: freezeCells(value.primaryCells),
		footprintCells: freezeCells(value.footprintCells),
		eraseEdges: Object.freeze(
			value.eraseEdges.map((edge) =>
				Object.freeze({ from: Object.freeze({ ...edge.from }), to: Object.freeze({ ...edge.to }) }),
			),
		),
		boundaries: Object.freeze(
			value.boundaries.map((boundary) =>
				Object.freeze({ ...boundary, cell: Object.freeze({ ...boundary.cell }) }),
			),
		),
		construction: Object.freeze({ ...value.construction }),
	});
}

function edgesFromPath(path: readonly Cell[]): DirectedRailEdge[] {
	const edges: DirectedRailEdge[] = [];
	for (let index = 0; index < path.length - 1; index++) {
		edges.push({ from: path[index] as Cell, to: path[index + 1] as Cell });
	}
	return edges;
}

function uniqueEdges(edges: readonly DirectedRailEdge[]): DirectedRailEdge[] {
	const unique = new Map<string, DirectedRailEdge>();
	for (const edge of edges) unique.set(directedEdgeKey(edge), edge);
	return [...unique.values()];
}

function boundariesFromEdges(edges: readonly DirectedRailEdge[]): readonly RailModuleBoundary[] {
	const first = edges[0];
	const last = edges.at(-1);
	if (!first || !last) return [];
	const inputDirection = directionBetween(first.from, first.to);
	const outputDirection = directionBetween(last.from, last.to);
	if (!inputDirection || !outputDirection) return [];
	return [
		{ role: "input", cell: first.from, direction: oppositeDirection(inputDirection) },
		{ role: "output", cell: last.to, direction: outputDirection },
	];
}

function hasStraightEdgePredecessor(
	byStart: ReadonlyMap<string, DirectedRailEdge>,
	edge: DirectedRailEdge,
): boolean {
	const direction = directionBetween(edge.from, edge.to);
	if (!direction) return false;
	const previous = moveCell(edge.from, oppositeDirection(direction));
	return byStart.has(`${cellKey(previous.x, previous.y)}:${direction}`);
}

function directedEdgeStartKey(edge: DirectedRailEdge): string {
	const direction = directionBetween(edge.from, edge.to);
	return `${cellKey(edge.from.x, edge.from.y)}:${direction ?? 0}`;
}

function moduleMatchesRoute(module: RailModuleOwnership, cell: Cell, hint: RailRouteHint): boolean {
	const incomingNeighbor = moveCell(cell, hint.incoming);
	const outgoingNeighbor = moveCell(cell, hint.outgoing);
	return (
		module.eraseEdges.some(
			(edge) => sameCell(edge.from, incomingNeighbor) && sameCell(edge.to, cell),
		) &&
		module.eraseEdges.some(
			(edge) => sameCell(edge.from, cell) && sameCell(edge.to, outgoingNeighbor),
		)
	);
}

function sameEdgeSet(
	left: readonly DirectedRailEdge[],
	right: readonly DirectedRailEdge[],
): boolean {
	if (left.length !== right.length) return false;
	const keys = new Set(left.map(directedEdgeKey));
	return right.every((edge) => keys.has(directedEdgeKey(edge)));
}

function directedEdgeKey(edge: DirectedRailEdge): string {
	return `${cellKey(edge.from.x, edge.from.y)}>${cellKey(edge.to.x, edge.to.y)}`;
}

function sideFor(forward: Direction, lateral: Direction): RailModuleSide {
	return lateral === leftDirection(forward) ? "left" : "right";
}

function leftDirection(direction: Direction): Direction {
	if (direction === 1) return 8;
	if (direction === 2) return 1;
	if (direction === 4) return 2;
	return 4;
}

function singleDirection(mask: number): Direction | null {
	if (bitCount(mask) !== 1) return null;
	return ALL_DIRECTIONS.find((direction) => (mask & direction) !== 0) ?? null;
}

function ownershipPriority(module: RailModuleOwnership): number {
	if (module.kind === "advanced-switch") return 0;
	if (module.kind === "turnout") return 1;
	return 2;
}

function freezeCells(cells: readonly Cell[]): readonly Cell[] {
	const unique = new Map<string, Cell>();
	for (const cell of cells) unique.set(cellKey(cell.x, cell.y), cell);
	return Object.freeze([...unique.values()].map((cell) => Object.freeze({ ...cell })));
}

function sameCell(left: Cell, right: Cell): boolean {
	return left.x === right.x && left.y === right.y;
}

function compareEdges(left: DirectedRailEdge, right: DirectedRailEdge): number {
	return (
		left.from.y - right.from.y ||
		left.from.x - right.from.x ||
		left.to.y - right.to.y ||
		left.to.x - right.to.x
	);
}

function compareModules(left: RailModuleOwnership, right: RailModuleOwnership): number {
	const leftCell = left.primaryCells[0] ?? { x: 0, y: 0 };
	const rightCell = right.primaryCells[0] ?? { x: 0, y: 0 };
	return leftCell.y - rightCell.y || leftCell.x - rightCell.x || left.key.localeCompare(right.key);
}
