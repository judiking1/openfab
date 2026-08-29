/** Collect each transferable ArrayBuffer exactly once from a structured-clone payload. */
export function collectTransferableBuffers(...roots: readonly unknown[]): ArrayBuffer[] {
	const buffers = new Set<ArrayBuffer>();
	const visited = new WeakSet<object>();
	const visit = (value: unknown): void => {
		if (value === null || typeof value !== "object") return;
		if (value instanceof ArrayBuffer) {
			buffers.add(value);
			return;
		}
		if (ArrayBuffer.isView(value)) {
			if (value.buffer instanceof ArrayBuffer) buffers.add(value.buffer);
			return;
		}
		if (visited.has(value)) return;
		visited.add(value);
		if (value instanceof Map) {
			for (const [key, entry] of value) {
				visit(key);
				visit(entry);
			}
			return;
		}
		if (value instanceof Set) {
			for (const entry of value) visit(entry);
			return;
		}
		for (const entry of Object.values(value)) visit(entry);
	};
	for (const root of roots) visit(root);
	return [...buffers];
}
