import { describe, expect, it } from "vitest";
import type { PortEquipmentState } from "../core/EquipmentGroup";
import type { PortRecord } from "../core/PortRecord";
import { planRailConstruction } from "../core/paint";
import { RailDocument } from "../core/RailDocument";
import { DIR_E, DIR_N, DIR_S, DIR_W } from "../core/railShape";
import { encodeRailCell, TileMap } from "../core/TileMap";
import { compilePhysicalRail } from "./PhysicalRailCompiler";
import { compilePortEquipmentInteractionPresentation } from "./PortEquipmentInteractionPresentation";
import {
	type CompiledPortEquipmentPresentation,
	compilePortEquipmentPresentation,
	PORT_EQUIPMENT_BODY_FACE_KIND,
} from "./PortEquipmentPresentation";
import {
	compilePortEquipmentShellPresentation,
	PORT_EQUIPMENT_SHELL_PRESENTATION_POLICY,
	portEquipmentShellPresentationFor,
} from "./PortEquipmentShellPresentation";

describe("PortEquipmentShellPresentation", () => {
	it("cuts one canonical multi-port EQ body into bounded spans with exact stable slot records", () => {
		const presentation = multiPortEqPresentation([1, 2, 3]);

		const shell = portEquipmentShellPresentationFor(presentation);

		expect(portEquipmentShellPresentationFor(presentation)).toBe(shell);
		expect(shell.policy).toBe(PORT_EQUIPMENT_SHELL_PRESENTATION_POLICY);
		expect(shell.revision).toBe(presentation.revision);
		expect(shell.bodySectionCount).toBe(1);
		expect(shell.shellSpanCount).toBe(4);
		expect([...shell.shellSpanBodySectionRows]).toEqual([0, 0, 0, 0]);
		expect([...shell.shellSpanEquipmentGroupIds]).toEqual([1, 1, 1, 1]);
		expect([...shell.shellSpanKinds]).toEqual([1, 1, 1, 1]);
		expect([...shell.portSlotIds]).toEqual([1, 2, 3]);
		expect([...shell.portSlotEquipmentGroupIds]).toEqual([1, 1, 1]);
		expect([...shell.portSlotKinds]).toEqual([1, 1, 1]);
		expect([...shell.portSlotBodySectionRows]).toEqual([0, 0, 0]);
		expect([...shell.portSlotFaceKinds]).toEqual([
			PORT_EQUIPMENT_BODY_FACE_KIND.WITH_SECTION_TANGENT,
			PORT_EQUIPMENT_BODY_FACE_KIND.WITH_SECTION_TANGENT,
			PORT_EQUIPMENT_BODY_FACE_KIND.WITH_SECTION_TANGENT,
		]);
		expect([...shell.portSlotCenters]).toEqual([2.5, 0.5, 4.5, 0.5, 6.5, 0.5]);
		expect([...shell.portOpeningCenters]).toEqual([...shell.portSlotCenters]);
		expect([...shell.portOpeningNormals]).toEqual([1, 0, 1, 0, 1, 0]);
		expect([...shell.portSlotHalfLengths]).toEqual([
			expect.closeTo(0.2, 5),
			expect.closeTo(0.2, 5),
			expect.closeTo(0.2, 5),
		]);
		expect([...shell.shellSpanCenters]).toEqual([
			expect.closeTo(2.15, 5),
			0.5,
			expect.closeTo(3.5, 5),
			0.5,
			expect.closeTo(5.5, 5),
			0.5,
			expect.closeTo(6.85, 5),
			0.5,
		]);
		expect(shell.byteLength).toBe(282);
		expect(Object.isFrozen(shell)).toBe(true);
	});

	it("is invariant to source port row order and keeps opposite facing as stable slot evidence", () => {
		const ordered = portEquipmentShellPresentationFor(multiPortEqPresentation([1, 2, 3], 2));
		const reordered = portEquipmentShellPresentationFor(multiPortEqPresentation([3, 1, 2], 2));

		for (const field of [
			"shellSpanBodySectionRows",
			"shellSpanEquipmentGroupIds",
			"shellSpanKinds",
			"shellSpanCenters",
			"shellSpanTangents",
			"shellSpanHalfExtents",
			"portSlotIds",
			"portSlotEquipmentGroupIds",
			"portSlotKinds",
			"portSlotBodySectionRows",
			"portSlotFaceKinds",
			"portSlotCenters",
			"portOpeningCenters",
			"portOpeningNormals",
			"portSlotHalfLengths",
			"portSlotHalfWidths",
			"portOpeningHalfHeights",
		] as const) {
			expect([...reordered[field]]).toEqual([...ordered[field]]);
		}
		expect([...ordered.portSlotFaceKinds]).toEqual([
			PORT_EQUIPMENT_BODY_FACE_KIND.WITH_SECTION_TANGENT,
			PORT_EQUIPMENT_BODY_FACE_KIND.AGAINST_SECTION_TANGENT,
			PORT_EQUIPMENT_BODY_FACE_KIND.WITH_SECTION_TANGENT,
		]);
		expect(ordered.portOpeningNormals[0]).toBeCloseTo(1, 6);
		expect(ordered.portOpeningNormals[1]).toBeCloseTo(0, 6);
		expect(ordered.portOpeningNormals[2]).toBeCloseTo(-1, 6);
		expect(ordered.portOpeningNormals[3]).toBeCloseTo(0, 6);
		expect(ordered.portOpeningNormals[4]).toBeCloseTo(1, 6);
		expect(ordered.portOpeningNormals[5]).toBeCloseTo(0, 6);
	});

	it("keeps one physical STK group partitioned into its exact disconnected body sections", () => {
		const hydrator = TileMap.createHydrator();
		for (let coordinate = 0; coordinate <= 7; coordinate++) {
			hydrator.addEncodedCell(coordinate, 0, encodeRailCell({ incoming: DIR_W, outgoing: DIR_E }));
			hydrator.addEncodedCell(20, coordinate, encodeRailCell({ incoming: DIR_N, outgoing: DIR_S }));
		}
		const state: PortEquipmentState = {
			nextPortId: 5,
			nextEquipmentGroupId: 2,
			ports: [
				stkPort(1, 1, 0, DIR_W, DIR_E),
				stkPort(2, 5, 0, DIR_W, DIR_E),
				stkPort(3, 20, 1, DIR_N, DIR_S),
				stkPort(4, 20, 5, DIR_N, DIR_S),
			],
			equipmentGroups: [{ id: 1, kind: "STK", template: "FLEX", portIds: [1, 2, 3, 4] }],
		};
		const presentation = compilePortEquipmentPresentation(
			compilePhysicalRail(hydrator.finish(16)),
			state,
		);

		const shell = compilePortEquipmentShellPresentation(presentation);

		expect(shell.bodySectionCount).toBe(2);
		expect(shell.shellSpanCount).toBe(6);
		expect([...shell.portSlotBodySectionRows]).toEqual([0, 0, 1, 1]);
		expect([...shell.portSlotIds]).toEqual([1, 2, 3, 4]);
		expect(new Set(shell.shellSpanBodySectionRows)).toEqual(new Set([0, 1]));
		for (let slotRow = 0; slotRow < shell.portSlotCount; slotRow++) {
			const sectionRow = shell.portSlotBodySectionRows[slotRow] as number;
			expect(presentation.bodySectionGroupRows[sectionRow]).toBe(0);
			expect(shell.portSlotEquipmentGroupIds[slotRow]).toBe(1);
		}
	});

	it("fails closed on a forged stable-port/body mapping or opening normal", () => {
		const presentation = multiPortEqPresentation([1, 2, 3]);
		const malformedMapping = {
			...presentation,
			portBodySectionRows: new Uint32Array(presentation.portBodySectionRows),
		} as CompiledPortEquipmentPresentation;
		malformedMapping.portBodySectionRows[1] = 99;
		const interaction = compilePortEquipmentInteractionPresentation(presentation);
		expect(() => compilePortEquipmentShellPresentation(malformedMapping, interaction)).toThrow(
			/stable identity mapping/i,
		);

		const malformedInteraction = {
			...interaction,
			portOpeningNormals: new Float32Array(interaction.portOpeningNormals),
		};
		malformedInteraction.portOpeningNormals[0] = 0;
		expect(() => compilePortEquipmentShellPresentation(presentation, malformedInteraction)).toThrow(
			/opening lies outside|opening face/i,
		);
	});
});

function multiPortEqPresentation(
	portRowOrder: readonly number[],
	againstTravelPortId: number | null = null,
): CompiledPortEquipmentPresentation {
	const document = new RailDocument();
	expect(document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 8, y: 0 }))).toBe(
		true,
	);
	const ports: PortRecord[] = [2, 4, 6].map((x, index) => ({
		id: index + 1,
		equipmentGroupId: 1,
		route: { kind: "CARDINAL_CELL" as const, x, z: 0, from: DIR_W, to: DIR_E },
		stationMillimeters: 500,
		side: "CENTER" as const,
		lateralOffsetMillimeters: 0,
		direction:
			index + 1 === againstTravelPortId ? ("AGAINST_TRAVEL" as const) : ("WITH_TRAVEL" as const),
		portType: "EQ" as const,
		barcode: `EQ-1-P0${index + 1}`,
	}));
	const state: PortEquipmentState = {
		nextPortId: 4,
		nextEquipmentGroupId: 2,
		ports: portRowOrder.map((portId) => ports[portId - 1]).filter((port) => port !== undefined),
		equipmentGroups: [
			{ id: 1, kind: "EQ", pitchMillimeters: 2_000, recipe: null, portIds: [1, 2, 3] },
		],
	};
	return compilePortEquipmentPresentation(compilePhysicalRail(document.map), state);
}

function stkPort(
	id: number,
	x: number,
	z: number,
	from: typeof DIR_W | typeof DIR_N,
	to: typeof DIR_E | typeof DIR_S,
) {
	return {
		id,
		equipmentGroupId: 1,
		route: { kind: "CARDINAL_CELL" as const, x, z, from, to },
		stationMillimeters: 500,
		side: "CENTER" as const,
		lateralOffsetMillimeters: 0,
		direction: "WITH_TRAVEL" as const,
		portType: "STK" as const,
		barcode: `STK-1-P0${id}`,
	};
}
