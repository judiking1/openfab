/**
 * Restore immutable ordinary containers after a Worker structured clone.
 * Typed-array bytes remain mutable and must still pass the existing checksum checks.
 * Freezing alone is not evidence that the prepared project is valid.
 */
export function freezeSyntheticFabStarterContainers(value: unknown): void {
	const visited = new WeakSet<object>();
	const pending: unknown[] = [value];
	while (pending.length > 0) {
		const current = pending.pop();
		if (
			typeof current !== "object" ||
			current === null ||
			ArrayBuffer.isView(current) ||
			visited.has(current)
		)
			continue;
		visited.add(current);
		for (const child of Array.isArray(current) ? current : Object.values(current)) {
			if (typeof child === "object" && child !== null) pending.push(child);
		}
		Object.freeze(current);
	}
}
