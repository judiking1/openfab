import type { StaticFabBlueprintTemplate } from "../core/StaticFabBlueprint";

/** Runtime guidance authority only; the authored document and ordinary history own the edit. */
export interface GuidedBuildCopySource {
	readonly document: object;
	readonly patchSequence: number;
	readonly checksum: string;
}

export interface GuidedBuildCopyReceipt {
	readonly document: object;
	readonly patchSequence: number;
	readonly sourceChecksum: string;
}

export interface GuidedBuildCopyRecoveryContext extends GuidedBuildCopySource {
	readonly settled: boolean;
	readonly reuseComplete: boolean;
	readonly canUndo: boolean;
	readonly commandsAvailable: boolean;
}

export function captureGuidedBuildCopySource(
	source: GuidedBuildCopySource,
	context: Readonly<{
		guided: boolean;
		missionId: string | null;
		origin: string;
		settled: boolean;
		template: StaticFabBlueprintTemplate | undefined;
	}>,
): GuidedBuildCopySource | null {
	const template = context.template;
	if (
		!context.guided ||
		context.missionId !== "reuse-loop" ||
		context.origin !== "selection-copy" ||
		!context.settled ||
		!template ||
		template.rail.sourceEdgeCount === 0 ||
		!Number.isSafeInteger(source.patchSequence) ||
		source.patchSequence < 0 ||
		!source.checksum
	)
		return null;
	// The actual copied selection must contain the practice equipment, not an unrelated
	// OHB/EQ/Stocker elsewhere in the project. Extraction already validates rail attachment.
	for (const [kind, minimum] of [
		["OHB", 1],
		["EQ", 2],
		["STK", 2],
	] as const) {
		if (
			!template.equipmentGroups.some(
				(group, index) =>
					group.kind === kind &&
					group.portIndices.length >= minimum &&
					group.portIndices.every(
						(portIndex) =>
							template.ports[portIndex]?.equipmentGroupIndex === index &&
							template.ports[portIndex]?.portType === kind,
					),
			)
		)
			return null;
	}
	return Object.freeze({ ...source });
}

export function completeGuidedBuildCopy(
	source: GuidedBuildCopySource | null | undefined,
	committed: Pick<GuidedBuildCopySource, "document" | "patchSequence">,
): GuidedBuildCopyReceipt | null {
	if (
		!source ||
		source.document !== committed.document ||
		!Number.isSafeInteger(committed.patchSequence) ||
		committed.patchSequence !== source.patchSequence + 1
	)
		return null;
	return Object.freeze({ ...committed, sourceChecksum: source.checksum });
}

export function guidedBuildCopyReceiptIsCurrent(
	receipt: GuidedBuildCopyReceipt | null,
	current: Pick<GuidedBuildCopySource, "document" | "patchSequence">,
): boolean {
	return (
		receipt !== null &&
		receipt.document === current.document &&
		receipt.patchSequence === current.patchSequence
	);
}

export function guidedBuildCopyRecoveryPhase(
	receipt: GuidedBuildCopyReceipt | null,
	current: GuidedBuildCopyRecoveryContext,
): "waiting" | "choice" | null {
	if (!guidedBuildCopyReceiptIsCurrent(receipt, current)) return null;
	if (!current.settled) return "waiting";
	return current.reuseComplete ? null : "choice";
}

/** Serializes retry activation without introducing a second history command. */
export class GuidedBuildCopyUndo {
	private pending = false;
	get isPending(): boolean {
		return this.pending;
	}

	async retry(
		receipt: GuidedBuildCopyReceipt,
		read: () => GuidedBuildCopyRecoveryContext,
		undo: () => Promise<boolean>,
	): Promise<"restored" | "refused" | "unavailable" | "stale"> {
		const current = read();
		if (
			this.pending ||
			!current.canUndo ||
			!current.commandsAvailable ||
			guidedBuildCopyRecoveryPhase(receipt, current) !== "choice"
		)
			return "unavailable";
		this.pending = true;
		try {
			if (!(await undo())) return "refused";
			const after = read();
			return after.document === receipt.document &&
				after.patchSequence === receipt.patchSequence + 1 &&
				after.checksum === receipt.sourceChecksum
				? "restored"
				: "stale";
		} finally {
			this.pending = false;
		}
	}
}
