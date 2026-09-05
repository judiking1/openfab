import {
	ADVANCED_SWITCH_MAX_ID,
	type AdvancedSwitchMutation,
	type AdvancedSwitchRecord,
	advancedSwitchEquals,
	copyAdvancedSwitch,
	deriveAdvancedSwitchGeometry,
} from "./AdvancedSwitch";
import { stableSortSteps } from "./CooperativeSort";
import { bitCount } from "./railShape";

/**
 * A rail cell stores directed ports, not a generic occupied bit.
 * Low nibble: sides where vehicles enter. High nibble: sides where they leave.
 * Keeping both masks in one byte gives the renderer and future worker a compact SoA-friendly source.
 */

const CHUNK_SIZE = 32;
const CHUNK_AREA = CHUNK_SIZE * CHUNK_SIZE;
const COPY_ON_WRITE_CHUNKS = new WeakSet<Uint8Array>();

export interface Cell {
	x: number;
	y: number;
}

export interface RailCell {
	incoming: number;
	outgoing: number;
}

export interface TileMapCellMutation extends Cell {
	before: number;
	after: number;
}

export interface TileMapMutationCheckpoint {
	readonly revision: number;
	readonly nextAdvancedSwitchId: number;
}

interface TileMapMutationCheckpointState {
	readonly map: TileMap;
	readonly revision: number;
	readonly mutationGeneration: number;
	readonly nextAdvancedSwitchId: number;
	consumed: boolean;
}

const mutationCheckpointStates = new WeakMap<object, TileMapMutationCheckpointState>();

export interface TileMapHydrator {
	readonly cellCount: number;
	readonly advancedSwitchCount: number;
	addEncodedCell(x: number, y: number, encoded: number): void;
	addAdvancedSwitch(record: AdvancedSwitchRecord): void;
	finish(revision: number, nextAdvancedSwitchId?: number): TileMap;
}

interface PreparedAdvancedSwitchState {
	switches: Map<number, AdvancedSwitchRecord>;
	claims: Map<string, number>;
	nextId: number;
	mutationCount: number;
}

export function cellKey(x: number, y: number): string {
	return `${x},${y}`;
}

export function encodeRailCell(cell: RailCell): number {
	return ((cell.outgoing & 15) << 4) | (cell.incoming & 15);
}

export function decodeRailCell(encoded: number): RailCell {
	return {
		incoming: encoded & 15,
		outgoing: (encoded >> 4) & 15,
	};
}

export class TileMap {
	private chunks = new Map<string, Uint8Array>();
	private advancedSwitches = new Map<number, AdvancedSwitchRecord>();
	private advancedSwitchClaims = new Map<string, number>();
	private railCellCount = 0;
	private directedEdgeCount = 0;
	private revision = 0;
	private nextAdvancedSwitchId = 1;
	/**
	 * Runtime-only mutation generation used by exact-generation capabilities.
	 *
	 * Serialized revision may intentionally rewind after an atomic rollback. This counter never does,
	 * so a validation capability cannot become current again through a revision ABA cycle. A guarded
	 * number keeps the per-cell hydration/mutation path allocation-free.
	 */
	private mutationGeneration = 0;

	get size(): number {
		return this.railCellCount;
	}

	get edgeCount(): number {
		return this.directedEdgeCount;
	}

	get advancedSwitchCount(): number {
		return this.advancedSwitches.size;
	}

	getRevision(): number {
		return this.revision;
	}

	getMutationGeneration(): number {
		return this.mutationGeneration;
	}

	getEncoded(x: number, y: number): number {
		const chunk = this.chunks.get(chunkKey(x, y));
		return chunk ? (chunk[localIndex(x, y)] as number) : 0;
	}

	getRail(x: number, y: number): RailCell {
		return decodeRailCell(this.getEncoded(x, y));
	}

	hasRail(x: number, y: number): boolean {
		return this.getEncoded(x, y) !== 0;
	}

	connectionMask(x: number, y: number): number {
		const rail = this.getRail(x, y);
		return rail.incoming | rail.outgoing;
	}

	getAdvancedSwitch(id: number): AdvancedSwitchRecord | undefined {
		return this.advancedSwitches.get(id);
	}

	getAdvancedSwitchOwningCell(x: number, y: number): AdvancedSwitchRecord | undefined {
		const id = this.advancedSwitchClaims.get(cellKey(x, y));
		return id === undefined ? undefined : this.advancedSwitches.get(id);
	}

	getAdvancedSwitchAtOrigin(x: number, y: number): AdvancedSwitchRecord | undefined {
		const owner = this.getAdvancedSwitchOwningCell(x, y);
		return owner?.origin.x === x && owner.origin.y === y ? owner : undefined;
	}

	hasAdvancedSwitchClaim(x: number, y: number): boolean {
		return this.advancedSwitchClaims.has(cellKey(x, y));
	}

	getNextAdvancedSwitchId(): number | null {
		return this.nextAdvancedSwitchId <= ADVANCED_SWITCH_MAX_ID ? this.nextAdvancedSwitchId : null;
	}

	/** Serializable cursor, including the exhausted MAX+1 state. */
	getAdvancedSwitchIdCursor(): number {
		return this.nextAdvancedSwitchId;
	}

	/** Bounded-step import boundary used by project/startup adapters before a map becomes editable. */
	static createHydrator(): TileMapHydrator {
		const map = new TileMap();
		let finished = false;
		const assertOpen = (): void => {
			if (finished) throw new Error("TileMap hydrator is already finished.");
		};
		return {
			get cellCount(): number {
				return map.railCellCount;
			},
			get advancedSwitchCount(): number {
				return map.advancedSwitches.size;
			},
			addEncodedCell(x: number, y: number, encoded: number): void {
				assertOpen();
				if (!Number.isInteger(x) || !Number.isInteger(y)) {
					throw new Error("Hydrated rail coordinates must be integers.");
				}
				if (!Number.isInteger(encoded) || encoded <= 0 || encoded > 0xff) {
					throw new Error("Hydrated rail cells must contain one non-zero byte.");
				}
				if (map.hasRail(x, y)) throw new Error(`Duplicate hydrated rail cell at ${cellKey(x, y)}.`);
				map.setEncoded(x, y, encoded);
			},
			addAdvancedSwitch(record: AdvancedSwitchRecord): void {
				assertOpen();
				if (map.getAdvancedSwitch(record.id)) {
					throw new Error(`Rail snapshot contains duplicate advanced switch id ${record.id}.`);
				}
				// The map is private until finish. Preflight one bounded footprint, then insert
				// without cloning every switch/claim map as ordinary editable mutations must.
				const next = copyAdvancedSwitch(record);
				const claimedCells = deriveAdvancedSwitchGeometry(next).claimedCells;
				for (const cell of claimedCells) {
					const ownerId = map.advancedSwitchClaims.get(cellKey(cell.x, cell.y));
					if (ownerId !== undefined && ownerId !== next.id) {
						throw new Error(
							`Advanced switch ${next.id} overlaps switch ${ownerId} at ${cell.x},${cell.y}.`,
						);
					}
				}
				const nextId = Math.max(map.nextAdvancedSwitchId, next.id + 1);
				const cursorWillChange = nextId !== map.nextAdvancedSwitchId;
				map.assertCanAdvanceMutationGeneration(cursorWillChange ? 2 : 1);
				map.advancedSwitches.set(next.id, next);
				for (const cell of claimedCells)
					map.advancedSwitchClaims.set(cellKey(cell.x, cell.y), next.id);
				map.nextAdvancedSwitchId = nextId;
				map.revision++;
				map.advanceMutationGeneration(cursorWillChange ? 2 : 1);
			},
			finish(revision: number, nextAdvancedSwitchId = map.nextAdvancedSwitchId): TileMap {
				assertOpen();
				if (!Number.isSafeInteger(revision) || revision < 0) {
					throw new Error("Hydrated TileMap revision must be a non-negative safe integer.");
				}
				if (
					!Number.isSafeInteger(nextAdvancedSwitchId) ||
					nextAdvancedSwitchId < map.nextAdvancedSwitchId ||
					nextAdvancedSwitchId > ADVANCED_SWITCH_MAX_ID + 1
				) {
					throw new Error("Hydrated advanced switch id cursor is invalid or moves backwards.");
				}
				finished = true;
				map.revision = revision;
				if (map.nextAdvancedSwitchId !== nextAdvancedSwitchId) {
					map.assertCanAdvanceMutationGeneration(1);
					map.nextAdvancedSwitchId = nextAdvancedSwitchId;
					map.advanceMutationGeneration();
				}
				return map;
			},
		};
	}

	/** Internal command surface. All editor mutations should still go through RailDocument. */
	setEncoded(x: number, y: number, encoded: number): boolean {
		const next = encoded & 0xff;
		const before = this.getEncoded(x, y);
		if (before === next) return false;

		this.assertCanAdvanceMutationGeneration(1);
		const chunk = this.getWritableChunk(x, y, next !== 0);
		if (!chunk) return false;
		chunk[localIndex(x, y)] = next;

		if (before === 0 && next !== 0) this.railCellCount++;
		if (before !== 0 && next === 0) this.railCellCount--;
		this.directedEdgeCount +=
			bitCount(decodeRailCell(next).outgoing) - bitCount(decodeRailCell(before).outgoing);
		this.revision++;
		this.advanceMutationGeneration();
		return true;
	}

	/** Internal command surface. Sidecar changes are committed atomically by RailDocument. */
	setAdvancedSwitch(switchRecord: AdvancedSwitchRecord): boolean {
		const next = copyAdvancedSwitch(switchRecord);
		const before = this.advancedSwitches.get(next.id) ?? null;
		if (advancedSwitchEquals(before, next)) return false;
		return this.applyAdvancedSwitchMutations([{ id: next.id, before, after: next }]);
	}

	deleteAdvancedSwitch(id: number): boolean {
		const before = this.advancedSwitches.get(id);
		if (!before) return false;
		return this.applyAdvancedSwitchMutations([{ id, before, after: null }]);
	}

	/** Apply a final-state-validated sidecar batch with one revision step per logical mutation. */
	applyAdvancedSwitchMutations(mutations: readonly AdvancedSwitchMutation[]): boolean {
		return this.applyAtomicMutations([], mutations);
	}

	/** Preflight cells and sidecars together, then publish the complete authored mutation batch. */
	applyAtomicMutations(
		cellMutations: readonly TileMapCellMutation[],
		switchMutations: readonly AdvancedSwitchMutation[],
	): boolean {
		if (cellMutations.length === 0 && switchMutations.length === 0) return false;
		const cellKeys = new Set<string>();
		for (const mutation of cellMutations) {
			const key = cellKey(mutation.x, mutation.y);
			if (cellKeys.has(key)) throw new Error(`Duplicate rail cell mutation at ${key}.`);
			cellKeys.add(key);
			if (
				!Number.isInteger(mutation.before) ||
				mutation.before < 0 ||
				mutation.before > 0xff ||
				!Number.isInteger(mutation.after) ||
				mutation.after < 0 ||
				mutation.after > 0xff ||
				mutation.before === mutation.after ||
				this.getEncoded(mutation.x, mutation.y) !== mutation.before
			) {
				throw new Error(`Rail cell ${key} before/after values are invalid.`);
			}
		}
		const prepared =
			switchMutations.length > 0 ? this.prepareAdvancedSwitchState(switchMutations) : null;
		const cursorWillChange = prepared !== null && prepared.nextId !== this.nextAdvancedSwitchId;
		this.assertCanAdvanceMutationGeneration(
			cellMutations.length + switchMutations.length + (cursorWillChange ? 1 : 0),
		);
		for (const mutation of cellMutations) {
			this.setEncoded(mutation.x, mutation.y, mutation.after);
		}
		if (prepared) {
			this.advancedSwitches = prepared.switches;
			this.advancedSwitchClaims = prepared.claims;
			this.nextAdvancedSwitchId = prepared.nextId;
			this.revision += prepared.mutationCount;
			this.advanceMutationGeneration(prepared.mutationCount);
			if (cursorWillChange) this.advanceMutationGeneration();
		}
		return true;
	}

	createMutationCheckpoint(): TileMapMutationCheckpoint {
		const checkpoint = Object.freeze({
			revision: this.revision,
			nextAdvancedSwitchId: this.nextAdvancedSwitchId,
		});
		mutationCheckpointStates.set(checkpoint, {
			map: this,
			revision: this.revision,
			mutationGeneration: this.mutationGeneration,
			nextAdvancedSwitchId: this.nextAdvancedSwitchId,
			consumed: false,
		});
		return checkpoint;
	}

	/** Restore an already-applied atomic batch after downstream publication fails. */
	rollbackAtomicMutations(
		cellMutations: readonly TileMapCellMutation[],
		switchMutations: readonly AdvancedSwitchMutation[],
		checkpoint: TileMapMutationCheckpoint,
	): void {
		const mutationCount = cellMutations.length + switchMutations.length;
		if (mutationCount === 0) {
			throw new Error("TileMap rollback requires at least one applied mutation.");
		}
		const checkpointState =
			typeof checkpoint === "object" && checkpoint !== null
				? mutationCheckpointStates.get(checkpoint)
				: undefined;
		if (checkpointState === undefined || checkpointState.map !== this || checkpointState.consumed) {
			throw new Error("TileMap rollback checkpoint is invalid, foreign, or already consumed.");
		}
		if (this.revision !== checkpointState.revision + mutationCount) {
			throw new Error("TileMap rollback checkpoint does not match the applied mutation batch.");
		}
		const appliedCursorAdvance =
			this.nextAdvancedSwitchId === checkpointState.nextAdvancedSwitchId ? 0 : 1;
		if (
			this.mutationGeneration !==
			checkpointState.mutationGeneration + mutationCount + appliedCursorAdvance
		) {
			throw new Error("TileMap rollback checkpoint is stale for the runtime mutation generation.");
		}
		const inverseCellMutations = cellMutations.map((mutation) => ({
			x: mutation.x,
			y: mutation.y,
			before: mutation.after,
			after: mutation.before,
		}));
		const inverseSwitchMutations = switchMutations.map((mutation) => ({
			id: mutation.id,
			before: mutation.after,
			after: mutation.before,
		}));
		const inverseSwitchState =
			inverseSwitchMutations.length > 0
				? this.prepareAdvancedSwitchState(inverseSwitchMutations)
				: null;
		const cursorAfterInverse = inverseSwitchState?.nextId ?? this.nextAdvancedSwitchId;
		const inverseCursorWillChange = cursorAfterInverse !== this.nextAdvancedSwitchId;
		const checkpointCursorWillChange = cursorAfterInverse !== checkpointState.nextAdvancedSwitchId;
		this.assertCanAdvanceMutationGeneration(
			mutationCount + (inverseCursorWillChange ? 1 : 0) + (checkpointCursorWillChange ? 1 : 0),
		);
		checkpointState.consumed = true;
		if (inverseCellMutations.length > 0) {
			this.applyAtomicMutations(inverseCellMutations, []);
		}
		if (inverseSwitchState) {
			this.advancedSwitches = inverseSwitchState.switches;
			this.advancedSwitchClaims = inverseSwitchState.claims;
			this.nextAdvancedSwitchId = inverseSwitchState.nextId;
			this.revision += inverseSwitchState.mutationCount;
			this.advanceMutationGeneration(inverseSwitchState.mutationCount);
			if (inverseCursorWillChange) this.advanceMutationGeneration();
		}
		this.revision = checkpointState.revision;
		if (this.nextAdvancedSwitchId !== checkpointState.nextAdvancedSwitchId) {
			this.assertCanAdvanceMutationGeneration(1);
			this.nextAdvancedSwitchId = checkpointState.nextAdvancedSwitchId;
			this.advanceMutationGeneration();
		}
	}

	private prepareAdvancedSwitchState(
		mutations: readonly AdvancedSwitchMutation[],
	): PreparedAdvancedSwitchState {
		const normalized: AdvancedSwitchMutation[] = [];
		const ids = new Set<number>();
		for (const mutation of mutations) {
			if (ids.has(mutation.id)) {
				throw new Error(`Duplicate advanced switch mutation for id ${mutation.id}.`);
			}
			ids.add(mutation.id);
			const current = this.advancedSwitches.get(mutation.id) ?? null;
			if (!advancedSwitchEquals(current, mutation.before)) {
				throw new Error(`Advanced switch ${mutation.id} before-value mismatch.`);
			}
			const after = mutation.after ? copyAdvancedSwitch(mutation.after) : null;
			if ((after?.id ?? mutation.before?.id ?? mutation.id) !== mutation.id) {
				throw new Error(`Advanced switch mutation id ${mutation.id} does not match its record.`);
			}
			if (advancedSwitchEquals(current, after)) {
				throw new Error(`Advanced switch mutation ${mutation.id} is empty.`);
			}
			normalized.push({ id: mutation.id, before: current, after });
		}

		const nextSwitches = new Map(this.advancedSwitches);
		const nextClaims = new Map(this.advancedSwitchClaims);
		for (const mutation of normalized) {
			if (!mutation.before) continue;
			nextSwitches.delete(mutation.id);
			for (const cell of deriveAdvancedSwitchGeometry(mutation.before).claimedCells) {
				const key = cellKey(cell.x, cell.y);
				if (nextClaims.get(key) === mutation.id) nextClaims.delete(key);
			}
		}
		for (const mutation of normalized) {
			if (!mutation.after) continue;
			for (const cell of deriveAdvancedSwitchGeometry(mutation.after).claimedCells) {
				const key = cellKey(cell.x, cell.y);
				const ownerId = nextClaims.get(key);
				if (ownerId !== undefined && ownerId !== mutation.id) {
					throw new Error(
						`Advanced switch ${mutation.id} overlaps switch ${ownerId} at ${cell.x},${cell.y}.`,
					);
				}
				nextClaims.set(key, mutation.id);
			}
			nextSwitches.set(mutation.id, mutation.after);
		}

		let nextId = this.nextAdvancedSwitchId;
		for (const mutation of normalized) {
			if (mutation.after && mutation.id >= nextId) {
				nextId = mutation.id + 1;
			}
		}
		return {
			switches: nextSwitches,
			claims: nextClaims,
			nextId,
			mutationCount: normalized.length,
		};
	}

	clearAll(): void {
		if (this.railCellCount === 0 && this.advancedSwitches.size === 0) return;
		this.assertCanAdvanceMutationGeneration(1);
		this.chunks.clear();
		this.advancedSwitches.clear();
		this.advancedSwitchClaims.clear();
		this.railCellCount = 0;
		this.directedEdgeCount = 0;
		this.revision++;
		this.advanceMutationGeneration();
	}

	clone(): TileMap {
		const copy = new TileMap();
		copy.chunks = new Map(this.chunks);
		for (const chunk of this.chunks.values()) COPY_ON_WRITE_CHUNKS.add(chunk);
		copy.advancedSwitches = new Map(
			[...this.advancedSwitches].map(([id, switchRecord]) => [
				id,
				copyAdvancedSwitch(switchRecord),
			]),
		);
		copy.advancedSwitchClaims = new Map(this.advancedSwitchClaims);
		copy.railCellCount = this.railCellCount;
		copy.directedEdgeCount = this.directedEdgeCount;
		copy.revision = this.revision;
		copy.nextAdvancedSwitchId = this.nextAdvancedSwitchId;
		copy.mutationGeneration = this.mutationGeneration;
		return copy;
	}

	private assertCanAdvanceMutationGeneration(delta: number): void {
		if (
			!Number.isSafeInteger(delta) ||
			delta < 0 ||
			!Number.isSafeInteger(this.mutationGeneration + delta)
		) {
			throw new Error("TileMap runtime mutation generation is exhausted.");
		}
	}

	private advanceMutationGeneration(delta = 1): void {
		this.mutationGeneration += delta;
	}

	forEachAdvancedSwitch(visit: (switchRecord: AdvancedSwitchRecord) => void): void {
		for (const id of [...this.advancedSwitches.keys()].sort((left, right) => left - right)) {
			visit(this.advancedSwitches.get(id) as AdvancedSwitchRecord);
		}
	}

	forEachRail(visit: (x: number, y: number, rail: RailCell, encoded: number) => void): void {
		for (const [key, chunk] of this.chunks) {
			const [cx, cy] = key.split(",").map(Number) as [number, number];
			for (let index = 0; index < CHUNK_AREA; index++) {
				const encoded = chunk[index] as number;
				if (encoded === 0) continue;
				const x = cx * CHUNK_SIZE + (index % CHUNK_SIZE);
				const y = cy * CHUNK_SIZE + Math.floor(index / CHUNK_SIZE);
				visit(x, y, decodeRailCell(encoded), encoded);
			}
		}
	}

	/** Traverse at most 32 storage cells per step, including empty cells in sparse chunks. */
	railTraversalSteps(
		visit: (x: number, y: number, rail: RailCell, encoded: number) => void,
	): Generator<void, void> {
		const chunks = this.chunks;
		const steps = function* (): Generator<void, void> {
			for (const [key, chunk] of chunks) {
				const [cx, cy] = key.split(",").map(Number) as [number, number];
				for (let index = 0; index < CHUNK_AREA; index++) {
					const encoded = chunk[index] as number;
					if (encoded !== 0) {
						const x = cx * CHUNK_SIZE + (index % CHUNK_SIZE);
						const y = cy * CHUNK_SIZE + Math.floor(index / CHUNK_SIZE);
						visit(x, y, decodeRailCell(encoded), encoded);
					}
					if ((index + 1) % 32 === 0) yield;
				}
			}
		};
		return this.guardTraversalGeneration(steps(), this.revision, this.mutationGeneration);
	}

	/** Collect and order switch IDs in bounded steps before visiting their immutable records. */
	advancedSwitchTraversalSteps(
		visit: (switchRecord: AdvancedSwitchRecord) => void,
	): Generator<void, void> {
		const switches = this.advancedSwitches;
		const steps = function* (): Generator<void, void> {
			const ids: number[] = [];
			for (const id of switches.keys()) {
				ids.push(id);
				yield;
			}
			yield* stableSortSteps(ids, (left, right) => left - right);
			for (const id of ids) {
				visit(switches.get(id) as AdvancedSwitchRecord);
				yield;
			}
		};
		return this.guardTraversalGeneration(steps(), this.revision, this.mutationGeneration);
	}

	private *guardTraversalGeneration(
		steps: Generator<void, void>,
		revision: number,
		mutationGeneration: number,
	): Generator<void, void> {
		const assertStableSource = (): void => {
			if (this.revision !== revision || this.mutationGeneration !== mutationGeneration) {
				throw new Error("TileMap changed during cooperative source traversal.");
			}
		};
		while (true) {
			assertStableSource();
			const next = steps.next();
			assertStableSource();
			if (next.done) return;
			yield;
		}
	}

	async forEachRailCooperatively(
		visit: (x: number, y: number, rail: RailCell, encoded: number) => void,
		checkpoint: () => Promise<void>,
		operationBudget = 128,
	): Promise<void> {
		if (!Number.isSafeInteger(operationBudget) || operationBudget <= 0) {
			throw new RangeError("Rail iteration operation budget must be positive.");
		}
		const expectedRevision = this.revision;
		const expectedMutationGeneration = this.mutationGeneration;
		let operations = 0;
		for (const [key, chunk] of this.chunks) {
			const [cx, cy] = key.split(",").map(Number) as [number, number];
			for (let index = 0; index < CHUNK_AREA; index++) {
				const encoded = chunk[index] as number;
				if (encoded === 0) continue;
				const x = cx * CHUNK_SIZE + (index % CHUNK_SIZE);
				const y = cy * CHUNK_SIZE + Math.floor(index / CHUNK_SIZE);
				visit(x, y, decodeRailCell(encoded), encoded);
				operations++;
				if (operations < operationBudget) continue;
				operations = 0;
				await checkpoint();
				if (
					this.revision !== expectedRevision ||
					this.mutationGeneration !== expectedMutationGeneration
				) {
					throw new Error("TileMap changed during cooperative rail iteration.");
				}
			}
		}
		await checkpoint();
		if (
			this.revision !== expectedRevision ||
			this.mutationGeneration !== expectedMutationGeneration
		) {
			throw new Error("TileMap changed during cooperative rail iteration.");
		}
	}

	bounds(): { minX: number; minY: number; maxX: number; maxY: number } | null {
		if (this.railCellCount === 0) return null;
		let minX = Number.POSITIVE_INFINITY;
		let minY = Number.POSITIVE_INFINITY;
		let maxX = Number.NEGATIVE_INFINITY;
		let maxY = Number.NEGATIVE_INFINITY;
		this.forEachRail((x, y) => {
			minX = Math.min(minX, x);
			minY = Math.min(minY, y);
			maxX = Math.max(maxX, x);
			maxY = Math.max(maxY, y);
		});
		return { minX, minY, maxX, maxY };
	}

	private getWritableChunk(x: number, y: number, create: boolean): Uint8Array | undefined {
		const key = chunkKey(x, y);
		const existing = this.chunks.get(key);
		if (existing) {
			if (!COPY_ON_WRITE_CHUNKS.has(existing)) return existing;
			const writable = existing.slice();
			this.chunks.set(key, writable);
			return writable;
		}
		if (!create) return undefined;
		const chunk = new Uint8Array(CHUNK_AREA);
		this.chunks.set(key, chunk);
		return chunk;
	}
}

function chunkKey(x: number, y: number): string {
	return `${Math.floor(x / CHUNK_SIZE)},${Math.floor(y / CHUNK_SIZE)}`;
}

function localIndex(x: number, y: number): number {
	const localX = ((x % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
	const localY = ((y % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
	return localY * CHUNK_SIZE + localX;
}
