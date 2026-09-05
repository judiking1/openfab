import { describe, expect, it } from "vitest";
import type { PortEquipmentState } from "../core/EquipmentGroup";
import { createRailEquipmentScaleProbeDocument } from "../worker/RailStartupFixture";
import { compilePhysicalRail } from "./PhysicalRailCompiler";
import { createPortAttachmentSourceIndex } from "./PortAttachmentResolver";
import {
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
		let visited = 0;
		visitPortEquipmentResolvedPositions(capability, layout, state, () => visited++);
		expect(visited).toBe(state.ports.length);
		expect(() =>
			visitPortEquipmentResolvedPositions({ ...capability }, layout, state, () => undefined),
		).toThrow("not certified");
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
