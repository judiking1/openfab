import { afterEach, describe, expect, it, vi } from "vitest";
import { compilePhysicalRail } from "../compile/PhysicalRailCompiler";
import * as presentationCompiler from "../compile/PortEquipmentPresentation";
import { bindPortEquipmentResolvedPositionIndex } from "../compile/PortEquipmentResolvedPositions";
import * as slotArtifacts from "../compile/PortSlotPreparedArtifacts";
import { RailDocument } from "../core/RailDocument";
import { createRailEquipmentScaleProbeDocument } from "../worker/RailStartupFixture";
import {
	createPortEquipmentEditorSnapshot,
	preparePortDerivedArtifactBundle,
} from "./PortEquipmentEditorSnapshot";

function source(document = createRailEquipmentScaleProbeDocument(8)) {
	const physical = compilePhysicalRail(document.map);
	return Object.freeze({
		document,
		physical,
		portEquipment: document.portEquipment,
		portSlotArtifacts: slotArtifacts.compilePortSlotPreparedArtifactCatalog(physical),
	});
}

afterEach(() => vi.restoreAllMocks());

describe("PortEquipmentEditorSnapshot", () => {
	it("publishes a required real empty presentation without compiling a second render artifact", () => {
		const model = source(new RailDocument());
		const compile = vi.spyOn(presentationCompiler, "compilePortEquipmentPresentation");
		const prepared = preparePortDerivedArtifactBundle(model, null, null);
		const snapshot = createPortEquipmentEditorSnapshot(model, prepared.presentation);
		const reused = preparePortDerivedArtifactBundle(model, null, prepared);

		expect(compile).toHaveBeenCalledTimes(1);
		expect(snapshot.model).toBe(model);
		expect(snapshot.portEquipmentPresentation).toBe(prepared.presentation);
		expect(snapshot.portEquipmentPresentation.count).toBe(0);
		expect(snapshot.portEquipmentPresentation.worldPositions).toHaveLength(0);
		expect(reused).toBe(prepared);
		expect(Object.isFrozen(snapshot)).toBe(true);
	});

	it("reuses exact presentation for metadata and tool changes while preparing current slot availability", () => {
		const model = source();
		const compile = vi.spyOn(presentationCompiler, "compilePortEquipmentPresentation");
		const availability = vi.spyOn(slotArtifacts, "createPreparedPortSlotAvailabilityIndex");
		const first = preparePortDerivedArtifactBundle(model, "OHB", null);
		const metadataModel = Object.freeze({ ...model, generation: 2 });
		const metadata = preparePortDerivedArtifactBundle(metadataModel, "OHB", first);
		const switched = preparePortDerivedArtifactBundle(metadataModel, "EQ", metadata);
		const snapshot = createPortEquipmentEditorSnapshot(metadataModel, switched.presentation);

		expect(compile).toHaveBeenCalledTimes(1);
		expect(availability).toHaveBeenCalledTimes(2);
		expect(metadata).toBe(first);
		expect(switched.presentation).toBe(first.presentation);
		expect(switched.artifacts).toBe(model.portSlotArtifacts.EQ);
		expect(switched.slots).toBe(model.portSlotArtifacts.EQ.slots);
		expect(switched.availability).not.toBe(first.availability);
		expect(switched.availability?.matchesPreparedArtifacts(model.portSlotArtifacts.EQ)).toBe(true);
		expect(snapshot.model).toBe(metadataModel);
		expect(snapshot.portEquipmentPresentation).toBe(first.presentation);
	});

	it("recompiles for replacement physical identity even with the same revision and geometry", () => {
		const model = source();
		const compile = vi.spyOn(presentationCompiler, "compilePortEquipmentPresentation");
		const first = preparePortDerivedArtifactBundle(model, null, null);
		const physical = compilePhysicalRail(model.document.map.clone());
		const replacement = Object.freeze({
			...model,
			physical,
			portSlotArtifacts: slotArtifacts.compilePortSlotPreparedArtifactCatalog(physical),
		});
		const next = preparePortDerivedArtifactBundle(replacement, null, first);

		expect(physical.revision).toBe(model.physical.revision);
		expect(compile).toHaveBeenCalledTimes(2);
		expect(next.presentation).not.toBe(first.presentation);
		expect(() => createPortEquipmentEditorSnapshot(replacement, first.presentation)).toThrow(
			"not certified",
		);
		expect(createPortEquipmentEditorSnapshot(replacement, next.presentation).model).toBe(
			replacement,
		);
	});

	it("does not retain stale equipment presentation when a replacement or restored source is published", () => {
		const model = source();
		const compile = vi.spyOn(presentationCompiler, "compilePortEquipmentPresentation");
		const first = preparePortDerivedArtifactBundle(model, null, null);
		const emptyModel = Object.freeze({ ...model, portEquipment: new RailDocument().portEquipment });
		const empty = preparePortDerivedArtifactBundle(emptyModel, null, first);
		const restored = preparePortDerivedArtifactBundle(model, null, empty);
		const foreignEquipmentModel = Object.freeze({
			...model,
			portEquipment: createRailEquipmentScaleProbeDocument(8).portEquipment,
		});
		const foreign = preparePortDerivedArtifactBundle(foreignEquipmentModel, null, restored);

		expect(compile).toHaveBeenCalledTimes(4);
		expect(first.presentation.count).toBe(8);
		expect(empty.presentation.count).toBe(0);
		expect(restored.presentation.count).toBe(8);
		expect(restored.presentation).not.toBe(first.presentation);
		expect(foreign.presentation).not.toBe(restored.presentation);
		expect(() =>
			createPortEquipmentEditorSnapshot(foreignEquipmentModel, restored.presentation),
		).toThrow("not certified");
		expect(
			bindPortEquipmentResolvedPositionIndex(
				foreign.presentation.resolvedPositions,
				foreignEquipmentModel.physical,
				foreignEquipmentModel.portEquipment,
			),
		).toBeDefined();
	});

	it("rejects a structural capability and foreign exact source instead of pairing by counts", () => {
		const model = source();
		const prepared = preparePortDerivedArtifactBundle(model, null, null);
		const forged = {
			...prepared.presentation,
			resolvedPositions: { ...prepared.presentation.resolvedPositions },
		};
		expect(() => createPortEquipmentEditorSnapshot(model, forged)).toThrow("not certified");
		expect(() =>
			preparePortDerivedArtifactBundle(model, null, { ...prepared, presentation: forged }),
		).toThrow("not certified");
	});

	it("leaves the current snapshot and bundle usable when incoming presentation compilation fails", () => {
		const model = source();
		const prepared = preparePortDerivedArtifactBundle(model, "OHB", null);
		const snapshot = createPortEquipmentEditorSnapshot(model, prepared.presentation);
		const next = Object.freeze({ ...model, portEquipment: new RailDocument().portEquipment });
		const compile = vi
			.spyOn(presentationCompiler, "compilePortEquipmentPresentation")
			.mockImplementation(() => {
				throw new Error("presentation preparation failed");
			});
		const availability = vi.spyOn(slotArtifacts, "createPreparedPortSlotAvailabilityIndex");

		expect(() => preparePortDerivedArtifactBundle(next, "OHB", prepared)).toThrow(
			"presentation preparation failed",
		);
		expect(compile).toHaveBeenCalledTimes(1);
		expect(availability).not.toHaveBeenCalled();
		expect(snapshot.model).toBe(model);
		expect(snapshot.portEquipmentPresentation).toBe(prepared.presentation);
		expect(prepared.portEquipment).toBe(model.portEquipment);
		expect(prepared.availability?.matchesPreparedArtifacts(model.portSlotArtifacts.OHB)).toBe(true);
		expect(
			createPortEquipmentEditorSnapshot(model, prepared.presentation).portEquipmentPresentation,
		).toBe(snapshot.portEquipmentPresentation);
	});

	it("leaves the current bundle unchanged when candidate availability preparation fails", () => {
		const model = source();
		const prepared = preparePortDerivedArtifactBundle(model, "OHB", null);
		const snapshot = createPortEquipmentEditorSnapshot(model, prepared.presentation);
		const compile = vi.spyOn(presentationCompiler, "compilePortEquipmentPresentation");
		vi.spyOn(slotArtifacts, "createPreparedPortSlotAvailabilityIndex").mockImplementation(() => {
			throw new Error("availability preparation failed");
		});

		expect(() => preparePortDerivedArtifactBundle(model, "EQ", prepared)).toThrow(
			"availability preparation failed",
		);
		expect(compile).not.toHaveBeenCalled();
		expect(prepared.portType).toBe("OHB");
		expect(prepared.artifacts).toBe(model.portSlotArtifacts.OHB);
		expect(snapshot.portEquipmentPresentation).toBe(prepared.presentation);
	});
});
