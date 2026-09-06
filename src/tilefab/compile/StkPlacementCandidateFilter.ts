import type { PortEquipmentState, StkAuthoringTemplate } from "../core/EquipmentGroup";
import { planStkPlacement } from "./PortPlacementPlanner";
import type { CompiledPortSlots, PortSlotAvailabilityIndex } from "./PortSlotCompiler";
import { evaluateStkDraftSelection, type StkDraftSlotQuery } from "./StkDraftSelector";

interface StkPlacementCandidateContext {
	readonly slots: CompiledPortSlots;
	readonly availability: PortSlotAvailabilityIndex;
	readonly state: PortEquipmentState;
	readonly rows: readonly number[] | null;
	readonly template: StkAuthoringTemplate;
	readonly revision: number;
	readonly sequence: number;
	readonly query: StkDraftSlotQuery;
}

/** Presentation advice only; the actual command always validates the current source again. */
export class StkPlacementCandidateFilter {
	private context: StkPlacementCandidateContext | null = null;
	private accepts: ((row: number) => boolean) | null = null;

	clear(): void {
		this.context = null;
		this.accepts = null;
	}

	forDraft(context: StkPlacementCandidateContext): (row: number) => boolean {
		const previous = this.context;
		if (
			previous &&
			previous.slots === context.slots &&
			previous.availability === context.availability &&
			previous.state === context.state &&
			previous.rows === context.rows &&
			previous.template === context.template &&
			previous.revision === context.revision &&
			previous.sequence === context.sequence &&
			this.accepts
		) {
			// query only projects this immutable slots catalog; its wrapper may change per frame.
			return this.accepts;
		}
		this.context = context;
		const results = new Map<number, boolean>();
		const rows = context.rows ?? [];
		this.accepts = (row) => {
			const cached = results.get(row);
			if (cached !== undefined) return cached;
			const selection = evaluateStkDraftSelection(
				context.slots,
				context.availability,
				[...rows, row],
				context.template,
				context.query,
			);
			const accepted =
				context.slots.revision === context.revision &&
				selection.valid &&
				(!selection.canComplete ||
					planStkPlacement(
						context.slots,
						selection.rows,
						context.availability,
						context.state,
						context.template,
						context.revision,
						context.sequence,
						context.query,
					).valid);
			// Panning can expose new rows indefinitely; keep only a small current-source cache.
			if (results.size >= 128) results.clear();
			results.set(row, accepted);
			return accepted;
		};
		return this.accepts;
	}
}
