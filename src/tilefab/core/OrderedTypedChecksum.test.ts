import { expect, it } from "vitest";
import { completeCooperativeSteps, createCooperativeTask } from "./CooperativeTask";
import { OrderedTypedChecksum } from "./OrderedTypedChecksum";

it("retains exact subview bytes and publishes each completed checksum chunk before yielding", async () => {
	const bytes = Uint8Array.from({ length: 40 }, (_, index) => (index * 37 + 19) % 256);
	const views = [bytes.subarray(3, 20), new Uint8Array(), bytes.subarray(23, 39)];
	for (const checkpointBytes of [1, 3, 7, 65_536]) {
		const checksum = new OrderedTypedChecksum();
		checksum.addNumbers([
			0,
			-0,
			Number.NaN,
			Number.POSITIVE_INFINITY,
			Number.NEGATIVE_INFINITY,
			1 / 3,
		]);
		checksum.addStrings(["", "Bay", "공장 🏭"]);
		const checkpoints: string[] = [];
		await checksum.addViewsCooperatively(
			views,
			async () => {
				checkpoints.push(checksum.digest());
			},
			checkpointBytes,
		);
		expect(checkpoints).toHaveLength(
			Math.ceil(17 / checkpointBytes) + Math.ceil(16 / checkpointBytes),
		);
		if (checkpointBytes === 7) {
			expect(checkpoints).toEqual([
				"8440aa5c:555fe208",
				"519e9944:c41fa85d",
				"3142af7b:84d38547",
				"ec856dc0:827685fc",
				"ecba14a4:7147ba48",
				"10c8f4eb:082a73dd",
			]);
		}
		checksum.addString("after");
		expect(checksum.digest()).toBe("fd20b4d7:0dd5bb85");
	}
});

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

it("projects a wide numeric sequence only as its bounded steps advance", () => {
	const values = Object.freeze(Array.from({ length: 4097 }, (_, index) => index * 0.25 - 500));
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings(["before"]);
	let reads = 0;
	const task = createCooperativeTask(
		checksum.addNumberSequenceSteps(values.length, (index) => {
			expect(index).toBe(reads++);
			return values[index] as number;
		}),
	);
	expect(reads).toBe(0);
	while (!task.done) {
		const before = reads;
		expect(task.step(17)).toBeLessThanOrEqual(17);
		expect(reads - before).toBeLessThanOrEqual(17);
	}
	task.finish();
	checksum.addStrings(["after"]);
	expect(reads).toBe(values.length);
	expect(checksum.digest()).toBe("32b36627:075f2ab6");
});

it.each([
	{ values: [] },
	{ values: [0, -0, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY] },
])("preserves empty and IEEE-754 projected sequence bytes for $values", ({ values }) => {
	const expected = new OrderedTypedChecksum();
	expected.addNumbers(values);
	const actual = new OrderedTypedChecksum();
	completeCooperativeSteps(
		actual.addNumberSequenceSteps(values.length, (index) => values[index] as number),
	);
	expect(actual.digest()).toBe(expected.digest());
});

it("retains one string-sequence prefix and UTF-8 bytes while projecting lazily", () => {
	const names = Object.freeze(["EMPTY_FOOTPRINT_V1", "Bay", "하위 조직", "", "工場 🏭"]);
	const expected = new OrderedTypedChecksum();
	expected.addNumbers([42]);
	expected.addStrings(names);
	expected.addNumbers([99]);
	const actual = new OrderedTypedChecksum();
	actual.addNumbers([42]);
	let reads = 0;
	const task = createCooperativeTask(
		actual.addStringSequenceSteps(names.length, (index) => {
			expect(index).toBe(reads++);
			return names[index] as string;
		}),
	);
	expect(reads).toBe(0);
	while (!task.done) {
		const before = reads;
		task.step(1);
		expect(reads - before).toBeLessThanOrEqual(1);
	}
	task.finish();
	actual.addNumbers([99]);
	expect(actual.digest()).toBe(expected.digest());
	const empty = new OrderedTypedChecksum();
	completeCooperativeSteps(
		empty.addStringSequenceSteps(0, () => {
			throw new Error("empty projection read");
		}),
	);
	const expectedEmpty = new OrderedTypedChecksum();
	expectedEmpty.addStrings([]);
	expect(empty.digest()).toBe(expectedEmpty.digest());
});

it.each([
	-1,
	0.5,
	Number.NaN,
	Number.POSITIVE_INFINITY,
	0x1_0000_0000,
])("rejects an unrepresentable projected length %s before changing checksum bytes", (length) => {
	for (const kind of ["number", "string"] as const) {
		const checksum = new OrderedTypedChecksum();
		checksum.addString("unchanged");
		const before = checksum.digest();
		let read = false;
		const steps =
			kind === "number"
				? checksum.addNumberSequenceSteps(length, () => {
						read = true;
						return 0;
					})
				: checksum.addStringSequenceSteps(length, () => {
						read = true;
						return "";
					});
		expect(() => steps.next()).toThrow("unsigned 32-bit prefix");
		expect(read).toBe(false);
		expect(checksum.digest()).toBe(before);
	}
});
