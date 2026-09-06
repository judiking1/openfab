import { expect, it } from "vitest";
import { createCooperativeTask } from "./CooperativeTask";
import { OrderedTypedChecksum } from "./OrderedTypedChecksum";

it("preserves a wide numeric sequence's single length prefix across cooperative batches", () => {
	const values = Object.freeze(Array.from({ length: 4097 }, (_, index) => index * 0.25 - 500));
	const synchronous = new OrderedTypedChecksum();
	synchronous.addStrings(["before"]);
	synchronous.addNumbers(values);
	synchronous.addStrings(["after"]);
	expect(synchronous.digest()).toBe("32b36627:075f2ab6");
	const cooperative = new OrderedTypedChecksum();
	cooperative.addStrings(["before"]);
	const task = createCooperativeTask(cooperative.addNumbersSteps(values));
	let batches = 0;
	while (!task.done) {
		expect(task.step(17)).toBeLessThanOrEqual(17);
		batches++;
	}
	task.finish();
	cooperative.addStrings(["after"]);
	expect(batches).toBeGreaterThan(200);
	expect(cooperative.digest()).toBe(synchronous.digest());
	const split = new OrderedTypedChecksum();
	split.addStrings(["before"]);
	split.addNumbers(values.slice(0, 17));
	split.addNumbers(values.slice(17));
	split.addStrings(["after"]);
	expect(split.digest()).not.toBe(synchronous.digest());
});

it.each([
	{ values: [] },
	{ values: [0, -0, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY] },
])("retains existing IEEE-754 and empty-sequence bytes for $values", ({ values }) => {
	const synchronous = new OrderedTypedChecksum();
	synchronous.addNumbers(values);
	const cooperative = new OrderedTypedChecksum();
	const task = createCooperativeTask(cooperative.addNumbersSteps(values));
	while (!task.done) task.step(1);
	expect(cooperative.digest()).toBe(synchronous.digest());
});
