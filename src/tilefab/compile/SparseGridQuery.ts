export interface SparseGridQueryBounds {
	readonly minX: number;
	readonly maxX: number;
	readonly minY: number;
	readonly maxY: number;
}

/** Visit occupied buckets in row-major order, bounding empty-space work by index size. */
export function visitSparseGridBuckets<T>(
	buckets: ReadonlyMap<string, T>,
	bounds: SparseGridQueryBounds,
	separator: "," | ":",
	visit: (bucket: T) => void,
): void {
	const { minX, maxX, minY, maxY } = bounds;
	if (
		buckets.size === 0 ||
		![minX, maxX, minY, maxY].every(Number.isSafeInteger) ||
		minX > maxX ||
		minY > maxY
	)
		return;
	const area = (maxX - minX + 1) * (maxY - minY + 1);
	if (area <= buckets.size * 3 + 16) {
		for (let y = minY; y <= maxY; y++) {
			for (let x = minX; x <= maxX; x++) {
				const bucket = buckets.get(`${x}${separator}${y}`);
				if (bucket !== undefined) visit(bucket);
			}
		}
		return;
	}
	const selected: { x: number; y: number; bucket: T }[] = [];
	for (const [key, bucket] of buckets) {
		const split = key.indexOf(separator);
		const x = Number(key.slice(0, split));
		const y = Number(key.slice(split + 1));
		if (x >= minX && x <= maxX && y >= minY && y <= maxY) selected.push({ x, y, bucket });
	}
	selected.sort((left, right) => left.y - right.y || left.x - right.x);
	for (const { bucket } of selected) visit(bucket);
}
