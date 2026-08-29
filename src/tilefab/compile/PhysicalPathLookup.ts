import { cellKey } from "../core/TileMap";
import type { CompiledPhysicalPaths } from "./PhysicalPathCompiler";
import { railClearancePathIdentity } from "./RailClearanceValidator";

export interface Int32CsrIndexSnapshot {
	readonly keyWidth: number;
	readonly keys: Int32Array;
	readonly offsets: Uint32Array;
	readonly values: Uint32Array;
}

export interface PhysicalPathCellLookup {
	get(key: string): Uint32Array | undefined;
}

export class PhysicalPathCellIndex implements PhysicalPathCellLookup {
	readonly snapshot: Int32CsrIndexSnapshot;
	private readonly index: Int32CsrIndex;

	constructor(snapshot: Int32CsrIndexSnapshot) {
		if (snapshot.keyWidth !== 2) throw new Error("Physical path cell index key width must be two.");
		this.snapshot = snapshot;
		this.index = new Int32CsrIndex(snapshot);
	}

	static compile(paths: CompiledPhysicalPaths): PhysicalPathCellIndex {
		return new PhysicalPathCellIndex(compilePhysicalPathCellIndex(paths));
	}

	get(key: string): Uint32Array | undefined {
		const comma = key.indexOf(",");
		if (comma <= 0 || comma === key.length - 1) return undefined;
		return this.getCell(Number(key.slice(0, comma)), Number(key.slice(comma + 1)));
	}

	getCell(x: number, y: number): Uint32Array | undefined {
		if (!Number.isInteger(x) || !Number.isInteger(y)) return undefined;
		return this.index.get([x, y]);
	}
}

export class PhysicalPathSwitchIndex {
	readonly snapshot: Int32CsrIndexSnapshot;
	private readonly index: Int32CsrIndex;

	constructor(snapshot: Int32CsrIndexSnapshot) {
		if (snapshot.keyWidth !== 1)
			throw new Error("Physical path switch index key width must be one.");
		this.snapshot = snapshot;
		this.index = new Int32CsrIndex(snapshot);
	}

	static compile(paths: CompiledPhysicalPaths): PhysicalPathSwitchIndex {
		return new PhysicalPathSwitchIndex(compilePhysicalPathSwitchIndex(paths));
	}

	get(switchId: number): Uint32Array | undefined {
		return Number.isInteger(switchId) ? this.index.get([switchId]) : undefined;
	}
}

export class PhysicalPathIdentityIndex {
	readonly snapshot: Int32CsrIndexSnapshot;
	private readonly index: Int32CsrIndex;

	constructor(snapshot: Int32CsrIndexSnapshot) {
		if (
			!(snapshot.keys instanceof Int32Array) ||
			!(snapshot.offsets instanceof Uint32Array) ||
			!(snapshot.values instanceof Uint32Array)
		) {
			throw new Error("Physical lookup CSR storage types are malformed.");
		}
		this.snapshot = snapshot;
		this.index = new Int32CsrIndex(snapshot);
	}

	static compile(paths: CompiledPhysicalPaths): PhysicalPathIdentityIndex {
		return new PhysicalPathIdentityIndex(compilePhysicalPathIdentityIndex(paths));
	}

	get(identity: ArrayLike<number>): Uint32Array | undefined {
		return this.index.get(identity);
	}
}

export function compilePhysicalPathCellIndex(paths: CompiledPhysicalPaths): Int32CsrIndexSnapshot {
	const mutable = new Map<string, { readonly key: readonly number[]; readonly values: number[] }>();
	for (let pathIndex = 0; pathIndex < paths.pathCount; pathIndex++) {
		const start = paths.coverageOffsets[pathIndex] as number;
		const end = paths.coverageOffsets[pathIndex + 1] as number;
		for (let row = start; row < end; row++) {
			const x = paths.coverageCells[row * 2] as number;
			const y = paths.coverageCells[row * 2 + 1] as number;
			const id = cellKey(x, y);
			const entry = mutable.get(id);
			if (entry) entry.values.push(pathIndex);
			else mutable.set(id, { key: [x, y], values: [pathIndex] });
		}
	}
	return compileCsr([...mutable.values()], 2);
}

export function compilePhysicalPathSwitchIndex(
	paths: CompiledPhysicalPaths,
): Int32CsrIndexSnapshot {
	const mutable = new Map<number, number[]>();
	for (let pathIndex = 0; pathIndex < paths.pathCount; pathIndex++) {
		const switchId = paths.advancedSwitchIds[pathIndex] as number;
		if (switchId === 0) continue;
		const values = mutable.get(switchId);
		if (values) values.push(pathIndex);
		else mutable.set(switchId, [pathIndex]);
	}
	return compileCsr(
		[...mutable].map(([key, values]) => ({ key: [key], values })),
		1,
	);
}

export function compilePhysicalPathIdentityIndex(
	paths: CompiledPhysicalPaths,
): Int32CsrIndexSnapshot {
	const mutable = new Map<string, { readonly key: Int32Array; readonly values: number[] }>();
	let keyWidth = 0;
	for (let pathIndex = 0; pathIndex < paths.pathCount; pathIndex++) {
		const identity = railClearancePathIdentity(paths, pathIndex);
		keyWidth = identity.length;
		const id = identity.join(":");
		const entry = mutable.get(id);
		if (entry) entry.values.push(pathIndex);
		else mutable.set(id, { key: identity, values: [pathIndex] });
	}
	return compileCsr([...mutable.values()], keyWidth || 1);
}

function compileCsr(
	entries: readonly { readonly key: ArrayLike<number>; readonly values: readonly number[] }[],
	keyWidth: number,
): Int32CsrIndexSnapshot {
	const sorted = [...entries].sort((left, right) => compareKeys(left.key, right.key, keyWidth));
	const keys = new Int32Array(sorted.length * keyWidth);
	const offsets = new Uint32Array(sorted.length + 1);
	let valueCount = 0;
	for (let row = 0; row < sorted.length; row++) {
		const entry = sorted[row] as (typeof sorted)[number];
		if (entry.key.length !== keyWidth)
			throw new Error("Physical lookup key width is inconsistent.");
		for (let field = 0; field < keyWidth; field++)
			keys[row * keyWidth + field] = entry.key[field] as number;
		offsets[row] = valueCount;
		valueCount += entry.values.length;
	}
	offsets[sorted.length] = valueCount;
	const values = new Uint32Array(valueCount);
	let writeIndex = 0;
	for (const entry of sorted) {
		for (const value of entry.values) values[writeIndex++] = value;
	}
	return Object.freeze({ keyWidth, keys, offsets, values });
}

class Int32CsrIndex {
	private readonly rowCount: number;
	private readonly snapshot: Int32CsrIndexSnapshot;

	constructor(snapshot: Int32CsrIndexSnapshot) {
		this.snapshot = snapshot;
		if (!Number.isSafeInteger(snapshot.keyWidth) || snapshot.keyWidth <= 0) {
			throw new Error("Physical lookup key width must be a positive safe integer.");
		}
		if (snapshot.keys.length % snapshot.keyWidth !== 0) {
			throw new Error("Physical lookup key storage does not match its width.");
		}
		this.rowCount = snapshot.keys.length / snapshot.keyWidth;
		if (
			snapshot.offsets.length !== this.rowCount + 1 ||
			snapshot.offsets[0] !== 0 ||
			snapshot.offsets[this.rowCount] !== snapshot.values.length
		) {
			throw new Error("Physical lookup CSR offsets are malformed.");
		}
		let previous = 0;
		for (const offset of snapshot.offsets) {
			if (offset < previous || offset > snapshot.values.length) {
				throw new Error("Physical lookup CSR offsets are malformed.");
			}
			previous = offset;
		}
	}

	get(key: ArrayLike<number>): Uint32Array | undefined {
		if (key.length !== this.snapshot.keyWidth) return undefined;
		let low = 0;
		let high = this.rowCount - 1;
		while (low <= high) {
			const middle = (low + high) >>> 1;
			const comparison = compareRow(this.snapshot, middle, key);
			if (comparison < 0) low = middle + 1;
			else if (comparison > 0) high = middle - 1;
			else {
				return this.snapshot.values.subarray(
					this.snapshot.offsets[middle] as number,
					this.snapshot.offsets[middle + 1] as number,
				);
			}
		}
		return undefined;
	}
}

function compareKeys(left: ArrayLike<number>, right: ArrayLike<number>, width: number): number {
	for (let field = 0; field < width; field++) {
		const difference = (left[field] as number) - (right[field] as number);
		if (difference !== 0) return difference;
	}
	return 0;
}

function compareRow(snapshot: Int32CsrIndexSnapshot, row: number, key: ArrayLike<number>): number {
	for (let field = 0; field < snapshot.keyWidth; field++) {
		const difference =
			(snapshot.keys[row * snapshot.keyWidth + field] as number) - (key[field] as number);
		if (difference !== 0) return difference;
	}
	return 0;
}
