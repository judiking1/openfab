import { describe, expect, it } from "vitest";
import type { PortEquipmentState } from "../core/EquipmentGroup";
import { createRailEquipmentScaleProbeDocument } from "../worker/RailStartupFixture";
import { compilePhysicalRail } from "./PhysicalRailCompiler";
import { createPortAttachmentSourceIndex } from "./PortAttachmentResolver";
import {
	bindPortEquipmentResolvedPositionIndex,
	compilePortEquipmentResolvedPositionCapability,
	visitPortEquipmentResolvedPositions,
} from "./PortEquipmentResolvedPositions";

describe("PortEquipmentResolvedPositions", () => {
	it("rejects structural capabilities and foreign state identities", () => {
		const document = createRailEquipmentScaleProbeDocument(8);
		const layout = compilePhysicalRail(document.map);
		const foreignLayout = compilePhysicalRail(document.map.clone());
		const state = document.portEquipment;
		const capability = compilePortEquipmentResolvedPositionCapability(layout, state);
		const index = bindPortEquipmentResolvedPositionIndex(capability, layout, state);
		expect(bindPortEquipmentResolvedPositionIndex(capability, layout, state)).toBe(index);
		let visited = 0;
		visitPortEquipmentResolvedPositions(capability, layout, state, () => visited++);
		expect(visited).toBe(state.ports.length);
		expect(() =>
			visitPortEquipmentResolvedPositions({ ...capability }, layout, state, () => undefined),
		).toThrow("not certified");
		for (const [proof, source, equipment] of [
			[{ ...capability }, layout, state],
			[capability, foreignLayout, state],
			[capability, layout, { ...state, ports: [...state.ports] }],
		] as const) {
			expect(() => bindPortEquipmentResolvedPositionIndex(proof, source, equipment)).toThrow(
				"not certified",
			);
		}
		expect(() =>
			visitPortEquipmentResolvedPositions(capability, foreignLayout, state, () => undefined),
		).toThrow("not certified");
		expect(() =>
			visitPortEquipmentResolvedPositions(
				capability,
				layout,
				{ ...state, ports: [...state.ports] },
				() => undefined,
			),
		).toThrow("not certified");
	});

	it("detects mutation of a non-canonical source after exact resolution", () => {
		const document = createRailEquipmentScaleProbeDocument(8);
		const layout = compilePhysicalRail(document.map);
		const state = structuredClone(document.portEquipment) as PortEquipmentState;
		const capability = compilePortEquipmentResolvedPositionCapability(layout, state);
		const mutablePort = state.ports[0];
		if (!mutablePort) throw new Error("Missing mutable Port fixture.");
		Object.assign(mutablePort, { stationMillimeters: mutablePort.stationMillimeters + 1 });
		expect(() =>
			visitPortEquipmentResolvedPositions(capability, layout, state, () => undefined),
		).toThrow("no longer matches");
		expect(() => bindPortEquipmentResolvedPositionIndex(capability, layout, state)).toThrow(
			"no longer matches",
		);
	});

	it("preserves authored bucket order and exact millimeter query coordinates", () => {
		const document = createRailEquipmentScaleProbeDocument(8);
		const layout = compilePhysicalRail(document.map);
		const source = document.portEquipment;
		const firstPort = source.ports[0];
		if (!firstPort) throw new Error("Missing port fixture");
		const state: PortEquipmentState = {
			...source,
			ports: source.ports.map((port, row) => ({
				...port,
				route: firstPort.route,
				stationMillimeters: 400 + row,
			})),
		};
		const capability = compilePortEquipmentResolvedPositionCapability(layout, state);
		const index = bindPortEquipmentResolvedPositionIndex(capability, layout, state);
		const exact: number[][] = [];
		visitPortEquipmentResolvedPositions(capability, layout, state, (_row, _port, x, z) => {
			exact.push([x, z]);
		});
		const rows: number[] = [];
		const firstPosition = exact[0];
		if (!firstPosition) throw new Error("Missing exact position");
		for (
			let row = index.firstRow(
				Math.floor(firstPosition[0] as number),
				Math.floor(firstPosition[1] as number),
			);
			row >= 0;
			row = index.nextRow(row)
		) {
			rows.push(row);
			expect([index.worldX(row), index.worldZ(row)]).toEqual(exact[row]);
		}
		expect(rows).toEqual(source.ports.map((_port, row) => row));
		expect(index.firstRow(-1_000, -1_000)).toBe(-1);
		expect(Object.isFrozen(index)).toBe(true);
	});

	it("accepts only a source index produced for the exact physical layout", () => {
		const document = createRailEquipmentScaleProbeDocument(8);
		const layout = compilePhysicalRail(document.map);
		const sourceIndex = createPortAttachmentSourceIndex(layout);
		expect(() =>
			compilePortEquipmentResolvedPositionCapability(
				layout,
				document.portEquipment,
				undefined,
				sourceIndex,
			),
		).not.toThrow();
		expect(() =>
			compilePortEquipmentResolvedPositionCapability(layout, document.portEquipment, undefined, {
				...sourceIndex,
			}),
		).toThrow("not certified");
	});

	it("rejects a forged source index for a fresh layout before registering its identity", () => {
		const document = createRailEquipmentScaleProbeDocument(8);
		const layout = compilePhysicalRail(document.map);
		expect(() =>
			compilePortEquipmentResolvedPositionCapability(layout, document.portEquipment, undefined, {
				sourcePathCount: layout.pathIntervalRemap.sourcePathCount,
				sourceRemap: layout.pathIntervalRemap,
				rows: () => Int32Array.of(0),
			}),
		).toThrow("not certified");
	});
});
