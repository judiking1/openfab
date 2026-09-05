import { expect, it } from "vitest";
import { freezeSyntheticFabStarterContainers } from "./SyntheticFabStarterContainers";

it("freezes cloned graphs through shared and cyclic containers while retaining mutable typed bytes", () => {
	const bytes = new Uint8Array([1, 2]);
	const child = { cells: [{ x: 1, y: 2 }], bytes };
	const graph: { child: typeof child; alias: typeof child; self?: unknown } = {
		child,
		alias: child,
	};
	graph.self = graph;
	Object.freeze(graph);

	freezeSyntheticFabStarterContainers(graph);

	expect(Object.isFrozen(child)).toBe(true);
	expect(Object.isFrozen(child.cells)).toBe(true);
	expect(Object.isFrozen(child.cells[0])).toBe(true);
	expect(graph.child).toBe(graph.alias);
	expect(graph.self).toBe(graph);
	bytes[0] = 7;
	expect(bytes[0]).toBe(7);
});

it("does not depend on the call stack when freezing a deeply nested transport graph", () => {
	const nodes: { child?: object }[] = [{}];
	for (let index = 1; index < 20_000; index++) {
		const previous = nodes[index - 1];
		if (!previous) throw new Error("Expected the previous container.");
		const next = {};
		previous.child = next;
		nodes.push(next);
	}

	freezeSyntheticFabStarterContainers(nodes[0]);

	expect(nodes.every(Object.isFrozen)).toBe(true);
});
