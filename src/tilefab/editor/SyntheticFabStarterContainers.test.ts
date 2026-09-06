import { expect, it } from "vitest";
import {
	freezeSyntheticFabStarterContainers,
	freezeSyntheticFabStarterContainersCooperatively,
} from "./SyntheticFabStarterContainers";

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

it("freezes each parent before yielding and retains separate mutable typed bytes", async () => {
	const bytes = new Uint8Array([1, 2]);
	const graph = { children: [{ bytes }] };
	let checkpoints = 0;
	await freezeSyntheticFabStarterContainersCooperatively(
		graph,
		async () => {
			checkpoints++;
			expect(Object.isFrozen(graph)).toBe(true);
			expect(() => {
				graph.children = [];
			}).toThrow();
		},
		1,
	);
	expect(checkpoints).toBeGreaterThan(4);
	expect(Object.isFrozen(graph.children)).toBe(true);
	expect(Object.isFrozen(graph.children[0])).toBe(true);
	bytes[0] = 7;
	expect(bytes[0]).toBe(7);
});

it("rejects accessor data without calling the getter", async () => {
	let reads = 0;
	const graph = {
		get child() {
			reads++;
			return {};
		},
	};
	await expect(
		freezeSyntheticFabStarterContainersCooperatively(graph, async () => {}, 1),
	).rejects.toThrow("data properties");
	expect(reads).toBe(0);
});

it("propagates cancellation before freezing unvisited descendants", async () => {
	const graph = { child: {} };
	const cancelled = new Error("cancel");
	await expect(
		freezeSyntheticFabStarterContainersCooperatively(
			graph,
			async () => {
				throw cancelled;
			},
			1,
		),
	).rejects.toBe(cancelled);
	expect(Object.isFrozen(graph)).toBe(true);
	expect(Object.isFrozen(graph.child)).toBe(false);
});
