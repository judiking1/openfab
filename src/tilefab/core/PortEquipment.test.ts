import { describe, expect, it } from "vitest";
import { completeCooperativeSteps, createCooperativeTask } from "./CooperativeTask";
import {
	applyPortEquipmentAdditionsCooperatively,
	applyPortEquipmentMutations,
	applyPortEquipmentMutationsSteps,
	collectPortEquipmentIntegrityIssues,
	copyEquipmentGroupRecord,
	copyPortEquipmentState,
	emptyPortEquipmentState,
	equipmentGroupError,
	isCanonicalPortEquipmentState,
	type PortEquipmentState,
	portEquipmentStateError,
	portEquipmentStateErrorSteps,
} from "./EquipmentGroup";
import { copyPortRecord, type PortRecord, portRecordError } from "./PortRecord";
import { DIR_E, DIR_W } from "./railShape";

describe("port and equipment-group authored records", () => {
	it("schedules reciprocal ownership checks through late records without changing their results", () => {
		const base = ohbState();
		const count = 257;
		const valid: PortEquipmentState = {
			nextPortId: count + 1,
			nextEquipmentGroupId: count + 1,
			ports: Array.from({ length: count }, (_, index) => ({
				...(base.ports[0] as PortRecord),
				id: index + 1,
				equipmentGroupId: index + 1,
				barcode: `Synthetic-${index + 1}`,
			})),
			equipmentGroups: Array.from({ length: count }, (_, index) => ({
				...(base.equipmentGroups[0] as PortEquipmentState["equipmentGroups"][number]),
				id: index + 1,
				portIds: [index + 1],
			})),
		};
		const scenarios: [PortEquipmentState, string | null][] = [
			[valid, null],
			[
				{
					...valid,
					ports: valid.ports.map((port) =>
						port.id === count ? { ...port, equipmentGroupId: 1 } : port,
					),
				},
				`port ${count} does not point back to equipment group ${count}`,
			],
			[{ ...valid, nextPortId: count }, "next port id cursor must exceed every port id"],
		];
		for (const [state, expected] of scenarios) {
			const task = createCooperativeTask(portEquipmentStateErrorSteps(state));
			let operations = 0;
			while (!task.done) {
				const used = task.step(7);
				expect(used).toBeLessThanOrEqual(7);
				operations += used;
			}
			expect(operations).toBeGreaterThan(count * 2);
			expect(task.finish()).toBe(expected);
			expect(portEquipmentStateError(state)).toBe(expected);
		}
	});
	it("privately prepares reciprocal relocation, removal, addition and reversal with the same cursors", () => {
		const base = copyPortEquipmentState(ohbState());
		const first = base.ports[0];
		const group = base.equipmentGroups[0];
		if (!first || !group) throw new Error("Missing OHB");
		const second = copyPortRecord({ ...first, id: 2, equipmentGroupId: 2, barcode: "Synthetic-2" });
		const secondGroup = copyEquipmentGroupRecord({ ...group, id: 2, portIds: [2] });
		const source = copyPortEquipmentState({
			...base,
			nextPortId: 3,
			nextEquipmentGroupId: 3,
			ports: [first, second],
			equipmentGroups: [group, secondGroup],
		});
		const portChanges = Object.freeze([
			Object.freeze({
				id: 1,
				before: first,
				after: copyPortRecord({
					...first,
					route: { kind: "CARDINAL_CELL", x: 10, z: 20, from: DIR_W, to: DIR_E },
				}),
			}),
			Object.freeze({ id: 2, before: second, after: null }),
			Object.freeze({
				id: 5,
				before: null,
				after: copyPortRecord({ ...second, id: 5, equipmentGroupId: 5 }),
			}),
		]);
		const groupChanges = Object.freeze([
			Object.freeze({ id: 2, before: secondGroup, after: null }),
			Object.freeze({
				id: 5,
				before: null,
				after: copyEquipmentGroupRecord({ ...secondGroup, id: 5, portIds: [5] }),
			}),
		]);
		const identity = JSON.stringify(source);
		const expected = applyPortEquipmentMutations(source, portChanges, groupChanges);
		const steps = applyPortEquipmentMutationsSteps(source, portChanges, groupChanges);
		let checkpoints = 0;
		for (let step = steps.next(); !step.done; step = steps.next()) {
			checkpoints++;
			expect(JSON.stringify(source)).toBe(identity);
		}
		const candidate = completeCooperativeSteps(
			applyPortEquipmentMutationsSteps(source, portChanges, groupChanges),
		);
		expect(candidate).toEqual(expected);
		expect(isCanonicalPortEquipmentState(candidate)).toBe(true);
		expect(candidate.nextPortId).toBe(6);
		expect(candidate.nextEquipmentGroupId).toBe(6);
		const reversePorts = Object.freeze(
			portChanges.map((change) =>
				Object.freeze({ ...change, before: change.after, after: change.before }),
			),
		);
		const reverseGroups = Object.freeze(
			groupChanges.map((change) =>
				Object.freeze({ ...change, before: change.after, after: change.before }),
			),
		);
		const restored = completeCooperativeSteps(
			applyPortEquipmentMutationsSteps(candidate, reversePorts, reverseGroups),
		);
		expect(restored).toEqual({ ...source, nextPortId: 6, nextEquipmentGroupId: 6 });
		for (let cancelAt = 0; cancelAt < checkpoints; cancelAt++) {
			const cancelled = applyPortEquipmentMutationsSteps(source, portChanges, groupChanges);
			for (let i = 0; i <= cancelAt; i++) cancelled.next();
			cancelled.return(source);
			expect(JSON.stringify(source)).toBe(identity);
		}
	});
	it("rejects stale ports, broken reciprocal ownership, duplicate barcodes and repeated changes privately", () => {
		const source = copyPortEquipmentState(ohbState());
		const port = source.ports[0];
		if (!port) throw new Error("Missing port");
		const move = Object.freeze({
			id: port.id,
			before: port,
			after: copyPortRecord({ ...port, barcode: "Changed" }),
		});
		const empty = Object.freeze([]);
		const batches = [
			Object.freeze([move, move]),
			Object.freeze([
				Object.freeze({ ...move, before: copyPortRecord({ ...port, barcode: "Stale" }) }),
			]),
			Object.freeze([Object.freeze({ ...move, after: port })]),
			Object.freeze([Object.freeze({ ...move, after: null })]),
			Object.freeze([
				Object.freeze({ ...move, after: copyPortRecord({ ...port, equipmentGroupId: 2 }) }),
			]),
		];
		for (const changes of batches)
			expect(() =>
				completeCooperativeSteps(applyPortEquipmentMutationsSteps(source, changes, empty)),
			).toThrow();
		const duplicate = Object.freeze([
			move,
			Object.freeze({
				id: 2,
				before: null,
				after: copyPortRecord({ ...port, id: 2, equipmentGroupId: 2, barcode: "Changed" }),
			}),
		]);
		const groups = Object.freeze([
			Object.freeze({
				id: 2,
				before: null,
				after: copyEquipmentGroupRecord({ id: 2, kind: "OHB", template: "SINGLE", portIds: [2] }),
			}),
		]);
		expect(() =>
			completeCooperativeSteps(applyPortEquipmentMutationsSteps(source, duplicate, groups)),
		).toThrow(/barcode/);
		expect(source.ports[0]).toBe(port);
		expect(completeCooperativeSteps(applyPortEquipmentMutationsSteps(source, empty, empty))).toBe(
			source,
		);
		expect(() =>
			completeCooperativeSteps(applyPortEquipmentMutationsSteps({ ...source }, empty, empty)),
		).toThrow(/canonical/);
	});
	it("bounds traversal and sorting over a 10001-station candidate", () => {
		const base = ohbState();
		const count = 10001;
		const first = base.ports[0];
		if (!first) throw new Error("Missing port");
		const source = copyPortEquipmentState({
			nextPortId: count + 1,
			nextEquipmentGroupId: count + 1,
			ports: Array.from({ length: count }, (_, i) => ({
				...first,
				id: i + 1,
				equipmentGroupId: i + 1,
				barcode: null,
			})),
			equipmentGroups: Array.from({ length: count }, (_, i) => ({
				id: i + 1,
				kind: "OHB",
				template: "SINGLE",
				portIds: [i + 1],
			})),
		});
		const last = source.ports.at(-1);
		if (!last) throw new Error("Missing final port");
		const changes = Object.freeze([
			Object.freeze({
				id: count,
				before: last,
				after: copyPortRecord({ ...last, barcode: "Synthetic-final" }),
			}),
		]);
		const task = createCooperativeTask(
			applyPortEquipmentMutationsSteps(source, changes, Object.freeze([])),
		);
		let slices = 0,
			maximum = 0;
		while (!task.done) {
			const started = performance.now();
			task.step(37);
			maximum = Math.max(maximum, performance.now() - started);
			slices++;
		}
		expect(slices).toBeGreaterThan(1000);
		expect(maximum).toBeLessThan(50);
		expect(task.finish().ports.at(-1)?.barcode).toBe("Synthetic-final");
		expect(source.ports.at(-1)?.barcode).toBeNull();
	});
	it("copies one valid OHB station as canonical immutable authored data", () => {
		const state = ohbState();
		const copied = copyPortEquipmentState(state);

		expect(portEquipmentStateError(copied)).toBeNull();
		expect(copied).toEqual(state);
		expect(copied).not.toBe(state);
		expect(Object.isFrozen(copied)).toBe(true);
		expect(Object.isFrozen(copied.ports[0]?.route)).toBe(true);
	});

	it("enforces ID cursors, one group owner, reciprocal references, and matching kinds", () => {
		const valid = ohbState();
		expect(portEquipmentStateError({ ...valid, nextPortId: 1 })).toBe(
			"next port id cursor must exceed every port id",
		);
		expect(
			portEquipmentStateError({ ...valid, ports: [...valid.ports, valid.ports[0] as PortRecord] }),
		).toBe("duplicate port id 1");
		expect(
			portEquipmentStateError({
				...valid,
				ports: [{ ...(valid.ports[0] as PortRecord), equipmentGroupId: 2 }],
			}),
		).toBe("port 1 does not point back to equipment group 1");
		expect(
			portEquipmentStateError({
				...valid,
				ports: [{ ...(valid.ports[0] as PortRecord), portType: "EQ" }],
			}),
		).toBe("port 1 type does not match equipment group 1");
		expect(
			portEquipmentStateError({
				...valid,
				nextPortId: 3,
				nextEquipmentGroupId: 3,
				ports: [
					valid.ports[0] as PortRecord,
					{
						...(valid.ports[0] as PortRecord),
						id: 2,
						equipmentGroupId: 2,
					},
				],
				equipmentGroups: [
					valid.equipmentGroups[0] as PortEquipmentState["equipmentGroups"][number],
					{ id: 2, kind: "OHB", template: "SINGLE", portIds: [2] },
				],
			}),
		).toContain("duplicate port barcode OHB-001");
	});

	it("rejects invalid route, offset, barcode, and stocker template contracts", () => {
		const port = ohbState().ports[0] as PortRecord;
		if (port.route.kind !== "CARDINAL_CELL") throw new Error("expected cardinal route fixture");
		expect(
			portRecordError({ ...port, route: { ...port.route, from: DIR_E, to: DIR_E } }),
		).toContain("non-degenerate");
		expect(portRecordError({ ...port, side: "CENTER", lateralOffsetMillimeters: 500 })).toContain(
			"center ports",
		);
		expect(portRecordError({ ...port, barcode: " bad " })).toContain("barcode");
		expect(portRecordError({ ...port, stationMillimeters: -1 })).toContain("station");
		expect(portRecordError({ ...port, stationMillimeters: 0x7fff_ffff })).toContain("station");
		expect(
			equipmentGroupError({
				id: 7,
				kind: "STK",
				template: "FOUR_PORT",
				portIds: [1, 2, 3],
			}),
		).toContain("exactly four");
	});

	it("rejects an oversized equipment group before reading or copying member IDs", () => {
		let memberReads = 0;
		const portIds = new Proxy(new Array<number>(65).fill(1), {
			get(target, key, receiver) {
				if (typeof key === "string" && /^\d+$/.test(key)) memberReads++;
				return Reflect.get(target, key, receiver);
			},
		});

		expect(() =>
			copyEquipmentGroupRecord({
				id: 1,
				kind: "EQ",
				portIds,
				pitchMillimeters: 1_000,
				recipe: null,
			}),
		).toThrow(/more than 64 ports/i);
		expect(memberReads).toBe(0);
	});

	it("provides a deterministic empty Phase 3 baseline", () => {
		expect(emptyPortEquipmentState()).toEqual({
			nextPortId: 1,
			nextEquipmentGroupId: 1,
			ports: [],
			equipmentGroups: [],
		});
	});

	it("cooperatively merges shuffled additions into the same canonical state", async () => {
		const current = copyPortEquipmentState(ohbState());
		const basePort = current.ports[0] as PortRecord;
		const portChanges = [
			{
				id: 3,
				before: null,
				after: { ...basePort, id: 3, equipmentGroupId: 3, barcode: "OHB-003" },
			},
			{
				id: 2,
				before: null,
				after: { ...basePort, id: 2, equipmentGroupId: 2, barcode: "OHB-002" },
			},
		] as const;
		const equipmentGroupChanges = [
			{
				id: 3,
				before: null,
				after: { id: 3, kind: "OHB", template: "SINGLE", portIds: [3] },
			},
			{
				id: 2,
				before: null,
				after: { id: 2, kind: "OHB", template: "SINGLE", portIds: [2] },
			},
		] as const;
		let checkpoints = 0;

		const actual = await applyPortEquipmentAdditionsCooperatively(
			current,
			portChanges,
			equipmentGroupChanges,
			async () => {
				checkpoints++;
			},
			1,
		);
		const expected = applyPortEquipmentMutations(current, portChanges, equipmentGroupChanges);

		expect(actual).toEqual(expected);
		expect(actual.ports.map((record) => record.id)).toEqual([1, 2, 3]);
		expect(actual.equipmentGroups.map((record) => record.id)).toEqual([1, 2, 3]);
		expect(Object.isFrozen(actual)).toBe(true);
		expect(checkpoints).toBeGreaterThan(0);
	});

	it("rejects duplicate cooperative additions without blessing a partial state", async () => {
		const current = copyPortEquipmentState(ohbState());
		const basePort = current.ports[0] as PortRecord;

		await expect(
			applyPortEquipmentAdditionsCooperatively(
				current,
				[
					{
						id: 2,
						before: null,
						after: { ...basePort, id: 2, equipmentGroupId: 2, barcode: "OHB-002" },
					},
					{
						id: 2,
						before: null,
						after: { ...basePort, id: 2, equipmentGroupId: 2, barcode: "OHB-002" },
					},
				],
				[],
				async () => {},
				1,
			),
		).rejects.toThrow("Port 2 addition before/after values are invalid.");
		expect(current).toEqual(copyPortEquipmentState(ohbState()));
	});

	it("collects simultaneous reciprocal, ownership, identity, and cursor issues in stable order", () => {
		const basePort = ohbState().ports[0] as PortRecord;
		const state: PortEquipmentState = {
			nextPortId: 1,
			nextEquipmentGroupId: 1,
			ports: [
				basePort,
				{ ...basePort, id: 2, equipmentGroupId: 99 },
				{ ...basePort, id: 3, equipmentGroupId: 2, portType: "EQ", barcode: null },
			],
			equipmentGroups: [
				{ id: 1, kind: "OHB", template: "SINGLE", portIds: [1, 2] },
				{ id: 2, kind: "OHB", template: "SINGLE", portIds: [3] },
				{ id: 3, kind: "OHB", template: "SINGLE", portIds: [3] },
				{ id: 4, kind: "OHB", template: "SINGLE", portIds: [77] },
			],
		};

		const issues = collectPortEquipmentIntegrityIssues(state);
		expect(issues.map((issue) => issue.code)).toEqual([
			"PORT_BARCODE_DUPLICATE",
			"EQUIPMENT_GROUP_RECORD_INVALID",
			"PORT_GROUP_POINTER_MISMATCH",
			"PORT_GROUP_TYPE_MISMATCH",
			"PORT_OWNED_BY_MULTIPLE_GROUPS",
			"PORT_GROUP_POINTER_MISMATCH",
			"PORT_GROUP_TYPE_MISMATCH",
			"EQUIPMENT_GROUP_PORT_MISSING",
			"PORT_EQUIPMENT_GROUP_MISSING",
			"NEXT_PORT_ID_CURSOR_STALE",
			"NEXT_EQUIPMENT_GROUP_ID_CURSOR_STALE",
		]);
		expect(issues[0]).toMatchObject({
			portIds: [1, 2],
			portRecordIndexes: [0, 1],
		});
		expect(issues[4]).toMatchObject({
			portIds: [3],
			equipmentGroupIds: [2, 3],
			portRecordIndexes: [2],
			equipmentGroupRecordIndexes: [1, 2],
		});
		expect(issues[7]).toMatchObject({
			portIds: [77],
			equipmentGroupIds: [4],
			equipmentGroupRecordIndexes: [3],
		});
		expect(portEquipmentStateError(state)).toBe(issues[0]?.message);
		expect(Object.isFrozen(issues)).toBe(true);
		expect(Object.isFrozen(issues[4]?.equipmentGroupIds)).toBe(true);
	});

	it("disambiguates duplicate IDs with record indexes without throwing", () => {
		const basePort = ohbState().ports[0] as PortRecord;
		const state: PortEquipmentState = {
			nextPortId: 4,
			nextEquipmentGroupId: 4,
			ports: [basePort, { ...basePort, equipmentGroupId: 2, barcode: "OHB-002" }],
			equipmentGroups: [
				{ id: 1, kind: "OHB", template: "SINGLE", portIds: [1] },
				{ id: 1, kind: "OHB", template: "SINGLE", portIds: [1] },
			],
		};

		const issues = collectPortEquipmentIntegrityIssues(state);
		expect(issues.find((issue) => issue.code === "PORT_ID_DUPLICATE")).toMatchObject({
			portIds: [1, 1],
			portRecordIndexes: [0, 1],
		});
		expect(issues.find((issue) => issue.code === "EQUIPMENT_GROUP_ID_DUPLICATE")).toMatchObject({
			equipmentGroupIds: [1, 1],
			equipmentGroupRecordIndexes: [0, 1],
		});
		expect(issues.filter((issue) => issue.code === "PORT_OWNED_BY_MULTIPLE_GROUPS")).toHaveLength(
			1,
		);
		expect(issues.find((issue) => issue.code === "PORT_GROUP_POINTER_MISMATCH")).toMatchObject({
			portIds: [1],
			equipmentGroupIds: [2, 1],
			portRecordIndexes: [1],
			equipmentGroupRecordIndexes: [0],
		});
		expect(portEquipmentStateError(state)).toBe("duplicate port id 1");
	});

	it("checks every duplicate port record against the canonical owning group", () => {
		const basePort = ohbState().ports[0] as PortRecord;
		const state: PortEquipmentState = {
			nextPortId: 2,
			nextEquipmentGroupId: 2,
			ports: [
				basePort,
				{
					...basePort,
					equipmentGroupId: 2,
					portType: "EQ",
					barcode: null,
				},
				{ ...basePort, barcode: null },
			],
			equipmentGroups: [{ id: 1, kind: "OHB", template: "SINGLE", portIds: [1] }],
		};

		const issues = collectPortEquipmentIntegrityIssues(state);
		expect(issues.find((issue) => issue.code === "PORT_GROUP_POINTER_MISMATCH")).toMatchObject({
			portRecordIndexes: [1],
			equipmentGroupRecordIndexes: [0],
		});
		expect(issues.find((issue) => issue.code === "PORT_GROUP_TYPE_MISMATCH")).toMatchObject({
			portRecordIndexes: [1],
			equipmentGroupRecordIndexes: [0],
		});
	});

	it("bounds duplicate-ID relationship witnesses to linear output", () => {
		const recordCount = 2_000;
		const basePort = ohbState().ports[0] as PortRecord;
		const state: PortEquipmentState = {
			nextPortId: 2,
			nextEquipmentGroupId: recordCount + 1,
			ports: Array.from({ length: recordCount }, () => ({ ...basePort, barcode: null })),
			equipmentGroups: Array.from({ length: recordCount }, (_, index) => ({
				id: index + 1,
				kind: "OHB" as const,
				template: "SINGLE" as const,
				portIds: [1],
			})),
		};

		const issues = collectPortEquipmentIntegrityIssues(state);
		const ownershipIssues = issues.filter(
			(issue) => issue.code === "PORT_OWNED_BY_MULTIPLE_GROUPS",
		);
		expect(issues.filter((issue) => issue.code === "PORT_ID_DUPLICATE")).toHaveLength(
			recordCount - 1,
		);
		expect(issues.filter((issue) => issue.code === "PORT_GROUP_POINTER_MISMATCH")).toHaveLength(
			(recordCount - 1) * 2,
		);
		expect(ownershipIssues).toHaveLength(recordCount - 1);
		expect(ownershipIssues.every((issue) => issue.portRecordIndexes.length <= 2)).toBe(true);
		expect(
			ownershipIssues.reduce((total, issue) => total + issue.portRecordIndexes.length, 0),
		).toBeLessThanOrEqual(recordCount * 2);
		expect(issues.length).toBeLessThan(recordCount * 5);
	});
});

function ohbState(): PortEquipmentState {
	return {
		nextPortId: 2,
		nextEquipmentGroupId: 2,
		ports: [
			{
				id: 1,
				equipmentGroupId: 1,
				route: { kind: "CARDINAL_CELL", x: 4, z: -2, from: DIR_W, to: DIR_E },
				stationMillimeters: 500,
				side: "LEFT",
				lateralOffsetMillimeters: 700,
				direction: "WITH_TRAVEL",
				portType: "OHB",
				barcode: "OHB-001",
			},
		],
		equipmentGroups: [{ id: 1, kind: "OHB", template: "SINGLE", portIds: [1] }],
	};
}
