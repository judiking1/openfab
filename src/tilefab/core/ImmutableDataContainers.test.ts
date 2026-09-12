import { describe, expect, it } from "vitest";
import { completeCooperativeSteps, createCooperativeTask } from "./CooperativeTask";
import {
	assertFrozenDataContainersSteps,
	freezeTransferDataContainersSteps,
} from "./ImmutableDataContainers";

describe("immutable data container traversal", () => {
	it("freezes parent references before suspension and completes shared cyclic graphs", () => {
		const child: { parent?: unknown; value: number } = { value: 1 };
		const root = { children: [child, child] };
		child.parent = root;
		const task = createCooperativeTask(freezeTransferDataContainersSteps(root));
		task.step(1);
		expect(Object.isFrozen(root)).toBe(true);
		expect(Reflect.set(root, "children", [])).toBe(false);
		while (!task.done) task.step(1);
		expect(Object.isFrozen(root.children)).toBe(true);
		expect(Object.isFrozen(child)).toBe(true);
		expect(child.parent).toBe(root);
		completeCooperativeSteps(assertFrozenDataContainersSteps(root));
	});

	it.each([
		"hole",
		"custom",
		"symbol",
		"hidden",
		"accessor",
	])("rejects an array with a %s property without invoking getters", (kind) => {
		let reads = 0;
		const values = [1, 2];
		if (kind === "hole") delete values[1];
		if (kind === "custom") Object.assign(values, { extra: 1 });
		if (kind === "symbol") Object.assign(values, { [Symbol("extra")]: 1 });
		if (kind === "hidden") Object.defineProperty(values, "1", { enumerable: false });
		if (kind === "accessor")
			Object.defineProperty(values, "1", {
				enumerable: true,
				get: () => {
					reads++;
					return 2;
				},
			});
		expect(() => completeCooperativeSteps(freezeTransferDataContainersSteps(values))).toThrow();
		expect(reads).toBe(0);
	});

	it("checks unfrozen descendants even when the root is already frozen", () => {
		const root = Object.freeze({ nested: { value: 1 } });
		expect(() => completeCooperativeSteps(assertFrozenDataContainersSteps(root))).toThrow(
			"fully frozen",
		);
		completeCooperativeSteps(freezeTransferDataContainersSteps(root));
		completeCooperativeSteps(assertFrozenDataContainersSteps(root));
	});

	it("retains the transfer-only typed view exception", () => {
		const bytes = new Uint8Array([1, 2]);
		const root = { bytes };
		completeCooperativeSteps(freezeTransferDataContainersSteps(root));
		expect(root.bytes).toBe(bytes);
		expect(() => completeCooperativeSteps(assertFrozenDataContainersSteps(root))).toThrow(
			"fully frozen",
		);
	});
});
