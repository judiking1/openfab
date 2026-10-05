import type { CompiledPhysicalLayout } from "../compile/PhysicalRailCompiler";
import {
	type CompiledPortEquipmentPresentation,
	compilePortEquipmentPresentation,
} from "../compile/PortEquipmentPresentation";
import { bindPortEquipmentResolvedPositionIndex } from "../compile/PortEquipmentResolvedPositions";
import type { CompiledPortSlots } from "../compile/PortSlotCompiler";
import {
	createPreparedPortSlotAvailabilityIndex,
	type PortSlotPreparedArtifactCatalog,
	type PortSlotPreparedArtifacts,
	type PreparedPortSlotAvailabilityIndex,
} from "../compile/PortSlotPreparedArtifacts";
import type { PortEquipmentState } from "../core/EquipmentGroup";
import type { PortType } from "../core/PortRecord";

interface PortEquipmentPresentationSource {
	readonly physical: CompiledPhysicalLayout;
	readonly portEquipment: PortEquipmentState;
}

interface PortDerivedArtifactSource extends PortEquipmentPresentationSource {
	readonly portSlotArtifacts: PortSlotPreparedArtifactCatalog;
}

export interface PortEquipmentEditorSnapshot<Model extends PortEquipmentPresentationSource> {
	readonly model: Model;
	readonly portEquipmentPresentation: CompiledPortEquipmentPresentation;
}

export interface PortDerivedArtifactBundle {
	readonly physical: CompiledPhysicalLayout;
	readonly artifacts: PortSlotPreparedArtifacts | null;
	readonly portEquipment: PortEquipmentState;
	readonly portType: PortType | null;
	readonly presentation: CompiledPortEquipmentPresentation;
	readonly slots: CompiledPortSlots | null;
	readonly availability: PreparedPortSlotAvailabilityIndex | null;
}

export function createPortEquipmentEditorSnapshot<Model extends PortEquipmentPresentationSource>(
	model: Model,
	portEquipmentPresentation: CompiledPortEquipmentPresentation,
): PortEquipmentEditorSnapshot<Model> {
	bindPortEquipmentResolvedPositionIndex(
		portEquipmentPresentation.resolvedPositions,
		model.physical,
		model.portEquipment,
	);
	return Object.freeze({ model, portEquipmentPresentation });
}

/** Prepare completely before the caller adopts a model, retires a Worker, or changes live refs. */
export function preparePortDerivedArtifactBundle(
	model: PortDerivedArtifactSource,
	portType: PortType | null,
	previous: PortDerivedArtifactBundle | null,
): PortDerivedArtifactBundle {
	const portEquipment = model.portEquipment;
	const artifacts = portType ? model.portSlotArtifacts[portType] : null;
	const presentation =
		previous?.physical === model.physical && previous.portEquipment === portEquipment
			? previous.presentation
			: compilePortEquipmentPresentation(model.physical, portEquipment);
	bindPortEquipmentResolvedPositionIndex(
		presentation.resolvedPositions,
		model.physical,
		portEquipment,
	);
	const canReuseAvailability =
		previous?.physical === model.physical &&
		previous.artifacts === artifacts &&
		previous.portEquipment === portEquipment &&
		previous.portType === portType &&
		previous.presentation === presentation;
	if (canReuseAvailability && previous) return previous;
	const availability = artifacts
		? createPreparedPortSlotAvailabilityIndex(
				model.physical,
				artifacts,
				portEquipment,
				presentation.resolvedPositions,
			)
		: null;
	return Object.freeze({
		physical: model.physical,
		artifacts,
		portEquipment,
		portType,
		presentation,
		slots: artifacts?.slots ?? null,
		availability,
	});
}
