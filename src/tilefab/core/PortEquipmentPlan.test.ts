import { describe, expect, it } from "vitest";
import type { EquipmentGroupMutation, EquipmentGroupRecord } from "./EquipmentGroup";
import {
	createPortEquipmentMutationPlan,
	createPortEquipmentMutationPlanWithImmutableGraphCertificate,
	createPortEquipmentMutationPlanWithImmutableGraphCertificateCooperatively,
	isCertifiedImmutablePortEquipmentMutationPlanGraph,
	type PortEquipmentMutationPlan,
	portEquipmentPlanKindError,
	portEquipmentPlanKindErrorCooperatively,
} from "./PortEquipmentPlan";
import type { PortMutation, PortRecord } from "./PortRecord";
import { DIR_E, DIR_W } from "./railShape";

describe("portEquipmentPlanKindError", () => {
	it("accepts exact single-kind placement and rejects kind widening", () => {
		const ohbPort = port(1, 1, "OHB");
		const ohbGroup = group(1, "OHB", [1]);
		const placement = createPortEquipmentMutationPlan(
			"place-ohb",
			0,
			0,
			[{ id: 1, before: null, after: ohbPort }],
			[{ id: 1, before: null, after: ohbGroup }],
		);

		expect(portEquipmentPlanKindError(placement)).toBeNull();
		expect(
			portEquipmentPlanKindError({
				...placement,
				kind: "place-eq",
			}),
		).toMatch(/another equipment kind/i);
		expect(
			portEquipmentPlanKindError({
				...placement,
				kind: "unknown-kind",
			} as unknown as PortEquipmentMutationPlan),
		).toMatch(/kind is invalid/i);
	});

	it("requires mixed additions for batch placement", () => {
		const ohbPort = port(1, 1, "OHB");
		const ohbGroup = group(1, "OHB", [1]);
		const homogeneous = createPortEquipmentMutationPlan(
			"place-port-equipment-batch",
			0,
			0,
			[{ id: 1, before: null, after: ohbPort }],
			[{ id: 1, before: null, after: ohbGroup }],
		);
		const stkPort = port(2, 2, "STK");
		const stkGroup = group(2, "STK", [2]);
		const mixed = createPortEquipmentMutationPlan(
			"place-port-equipment-batch",
			0,
			0,
			[
				{ id: 1, before: null, after: ohbPort },
				{ id: 2, before: null, after: stkPort },
			],
			[
				{ id: 1, before: null, after: ohbGroup },
				{ id: 2, before: null, after: stkGroup },
			],
		);

		expect(portEquipmentPlanKindError(homogeneous)).toMatch(/more than one equipment kind/i);
		expect(portEquipmentPlanKindError(mixed)).toBeNull();
	});

	it("rejects deletions labeled as placement, additions labeled as erase, and group creation as edit", () => {
		const record = port(1, 1, "OHB");
		const equipment = group(1, "OHB", [1]);
		const deletionAsPlacement = createPortEquipmentMutationPlan(
			"place-ohb",
			0,
			0,
			[{ id: 1, before: record, after: null }],
			[{ id: 1, before: equipment, after: null }],
		);
		const additionAsErase = createPortEquipmentMutationPlan(
			"erase-port-equipment",
			0,
			0,
			[{ id: 1, before: null, after: record }],
			[{ id: 1, before: null, after: equipment }],
		);
		const creationAsEdit = createPortEquipmentMutationPlan(
			"edit-port-equipment",
			0,
			0,
			[{ id: 1, before: null, after: record }],
			[{ id: 1, before: null, after: equipment }],
		);

		expect(portEquipmentPlanKindError(deletionAsPlacement)).toMatch(/only add/i);
		expect(portEquipmentPlanKindError(additionAsErase)).toMatch(/only remove/i);
		expect(portEquipmentPlanKindError(creationAsEdit)).toMatch(/existing equipment groups/i);
	});

	it("certifies only the exact identity of a recursively frozen own-data graph", () => {
		const mutablePort = port(1, 1, "OHB");
		const mutableGroup = group(1, "OHB", [1]);
		const mutableGraph = createPortEquipmentMutationPlan(
			"place-ohb",
			0,
			0,
			[{ id: 1, before: null, after: mutablePort }],
			[{ id: 1, before: null, after: mutableGroup }],
		);
		expect(isCertifiedImmutablePortEquipmentMutationPlanGraph(mutableGraph)).toBe(false);
		expect(() =>
			createPortEquipmentMutationPlanWithImmutableGraphCertificate(
				"place-ohb",
				0,
				0,
				[{ id: 1, before: null, after: mutablePort }],
				[{ id: 1, before: null, after: mutableGroup }],
			),
		).toThrow(/recursively immutable/i);

		const immutablePort = Object.freeze({
			...port(1, 1, "OHB"),
			route: Object.freeze({ ...port(1, 1, "OHB").route }),
		});
		const immutableGroup = Object.freeze({
			...group(1, "OHB", [1]),
			portIds: Object.freeze([1]),
		});
		let accessorCalls = 0;
		const accessorMutation = { id: 1, before: null } as Record<string, unknown>;
		Object.defineProperty(accessorMutation, "after", {
			enumerable: true,
			get() {
				accessorCalls++;
				return immutablePort;
			},
		});
		Object.freeze(accessorMutation);
		expect(() =>
			createPortEquipmentMutationPlanWithImmutableGraphCertificate(
				"place-ohb",
				0,
				0,
				[accessorMutation as unknown as PortMutation],
				[
					Object.freeze({
						id: 1,
						before: null,
						after: immutableGroup,
					}) as EquipmentGroupMutation,
				],
			),
		).toThrow(/recursively immutable/i);
		expect(accessorCalls).toBe(0);

		const immutableGraph = createPortEquipmentMutationPlanWithImmutableGraphCertificate(
			"place-ohb",
			0,
			0,
			[Object.freeze({ id: 1, before: null, after: immutablePort })],
			[Object.freeze({ id: 1, before: null, after: immutableGroup })],
		);
		expect(isCertifiedImmutablePortEquipmentMutationPlanGraph(immutableGraph)).toBe(true);
		expect(isCertifiedImmutablePortEquipmentMutationPlanGraph({ ...immutableGraph })).toBe(false);
	});

	it("cooperatively certifies the same exact immutable mutation graph identity", async () => {
		const immutablePort = Object.freeze({
			...port(1, 1, "OHB"),
			route: Object.freeze({ ...port(1, 1, "OHB").route }),
		});
		const immutableGroup = Object.freeze({
			...group(1, "OHB", [1]),
			portIds: Object.freeze([1]),
		});
		let checkpoints = 0;
		const plan = await createPortEquipmentMutationPlanWithImmutableGraphCertificateCooperatively(
			"place-ohb",
			0,
			0,
			[Object.freeze({ id: 1, before: null, after: immutablePort })],
			[Object.freeze({ id: 1, before: null, after: immutableGroup })],
			async () => {
				checkpoints++;
			},
			1,
		);

		expect(checkpoints).toBe(3);
		expect(isCertifiedImmutablePortEquipmentMutationPlanGraph(plan)).toBe(true);
		expect(isCertifiedImmutablePortEquipmentMutationPlanGraph({ ...plan })).toBe(false);
		expect(
			await portEquipmentPlanKindErrorCooperatively(
				plan,
				async () => {
					checkpoints++;
				},
				1,
			),
		).toBe(portEquipmentPlanKindError(plan));
		expect(checkpoints).toBe(7);
	});
});

function port(id: number, equipmentGroupId: number, portType: "OHB" | "EQ" | "STK"): PortRecord {
	return {
		id,
		equipmentGroupId,
		route: { kind: "CARDINAL_CELL", x: id, z: 0, from: DIR_W, to: DIR_E },
		stationMillimeters: 500,
		side: portType === "OHB" ? "LEFT" : "CENTER",
		lateralOffsetMillimeters: portType === "OHB" ? 700 : 0,
		direction: "WITH_TRAVEL",
		portType,
		barcode: null,
	};
}

function group(id: number, kind: "OHB" | "STK", portIds: readonly number[]): EquipmentGroupRecord {
	return kind === "OHB"
		? { id, kind, template: "SINGLE", portIds }
		: { id, kind, template: "FLEX", portIds };
}
