import { classifyRailCell } from "../core/RailCellClassification";
import type { RailDocument, RailPatchEvent } from "../core/RailDocument";
import type { RailModuleOwnership, RailModuleOwnershipIndex } from "../core/RailModuleOwnership";
import { railPatchTransitionFingerprint } from "../core/RailPatchHistory";
import { type Cell, encodeRailCell, type TileMap } from "../core/TileMap";

/** Keep an existing semantic identity exact; only pending selections may resolve by cell. */
export function resolveRailSelectionOwnership(
	index: RailModuleOwnershipIndex,
	cell: Cell,
	currentModuleKey: string | null,
): RailModuleOwnership | null {
	if (currentModuleKey !== null) return index.find(currentModuleKey);
	const resolution = index.resolve(cell);
	return resolution.status === "resolved" ? resolution.module : null;
}

interface EndpointSelection {
	readonly cell: Cell;
	readonly moduleKey: string;
	readonly encoded: number;
}

interface SelectionIdentity {
	readonly document: RailDocument;
	readonly cell: Cell;
	readonly moduleKey: string | null;
	readonly endpoint: EndpointSelection | null;
}

interface EndpointMoveReceipt {
	readonly document: RailDocument;
	readonly sequence: number;
	readonly phase: "applied" | "undone";
	readonly before: EndpointSelection;
	readonly after: EndpointSelection;
	readonly forward: string;
	readonly reverse: string;
}

interface PreparedEndpointMove {
	readonly document: RailDocument;
	readonly sequence: number;
	readonly revision: number;
	readonly before: EndpointSelection;
	readonly target: Cell;
}

type PendingEndpointSelection = Readonly<{
	document: RailDocument;
	sequence: number;
	revision: number;
	expectedSelection: SelectionIdentity;
}> &
	(
		| Readonly<{
				kind: "apply";
				before: EndpointSelection;
				target: Cell;
				encoded: number;
				forward: string;
				reverse: string;
		  }>
		| Readonly<{ kind: "replay"; receipt: EndpointMoveReceipt; target: EndpointSelection }>
		| Readonly<{ kind: "guard"; target: EndpointSelection }>
	);

export type EndpointSelectionProjection =
	| Readonly<{ cell: Cell; module: RailModuleOwnership }>
	| "clear"
	| null;

function endpointSelection(
	map: TileMap,
	index: RailModuleOwnershipIndex,
	cell: Cell,
	moduleKey?: string | null,
): EndpointSelection | null {
	if (index.revision !== map.getRevision()) return null;
	const rail = map.getRail(cell.x, cell.y);
	if (classifyRailCell(rail) !== "TERMINAL" || map.getAdvancedSwitchOwningCell(cell.x, cell.y))
		return null;
	const resolved = index.resolve(cell);
	if (resolved.status !== "resolved" || (moduleKey != null && resolved.module.key !== moduleKey))
		return null;
	return { cell: { ...cell }, moduleKey: resolved.module.key, encoded: encodeRailCell(rail) };
}

function sameEndpoint(left: EndpointSelection | null, right: EndpointSelection | null): boolean {
	return Boolean(
		left &&
			right &&
			left.cell.x === right.cell.x &&
			left.cell.y === right.cell.y &&
			left.moduleKey === right.moduleKey &&
			left.encoded === right.encoded,
	);
}

function sameSelection(left: SelectionIdentity | null, right: SelectionIdentity): boolean {
	return Boolean(
		left &&
			left.document === right.document &&
			left.cell.x === right.cell.x &&
			left.cell.y === right.cell.y &&
			left.moduleKey === right.moduleKey,
	);
}

/** Runtime-only correspondence for the latest endpoint move; it never changes authored data. */
export class EndpointSelectionHistory {
	private selection: SelectionIdentity | null = null;
	private prepared: PreparedEndpointMove | null = null;
	private pending: PendingEndpointSelection | null = null;
	private receipt: EndpointMoveReceipt | null = null;

	reset(): void {
		this.selection = null;
		this.prepared = null;
		this.pending = null;
		this.receipt = null;
	}

	select(
		document: RailDocument,
		map: TileMap,
		index: RailModuleOwnershipIndex,
		cell: Cell | null,
		moduleKey: string | null,
	): void {
		const next: SelectionIdentity | null = cell
			? {
					document,
					cell: { ...cell },
					moduleKey,
					endpoint: endpointSelection(map, index, cell, moduleKey),
				}
			: null;
		if (!next || !sameSelection(this.selection, next)) {
			this.receipt = null;
			this.pending = null;
			this.prepared = null;
		}
		this.selection = next;
	}

	prepareMove(document: RailDocument, target: Cell): void {
		const before = this.selection?.endpoint;
		this.prepared =
			before &&
			this.selection?.document === document &&
			encodeRailCell(document.map.getRail(before.cell.x, before.cell.y)) === before.encoded &&
			(before.cell.x !== target.x || before.cell.y !== target.y)
				? {
						document,
						sequence: document.getPatchSequence(),
						revision: document.map.getRevision(),
						before,
						target: { ...target },
					}
				: null;
	}

	finishMove(): void {
		this.prepared = null;
	}

	get awaitingMovePublication(): boolean {
		return this.pending?.kind === "apply";
	}

	/** Observe the actual atomic patch, including commands outside the reshape UI. */
	observePatch(document: RailDocument, event: RailPatchEvent): void {
		const prepared = this.prepared;
		const receipt = this.receipt;
		const selection = this.selection;
		this.prepared = null;
		this.pending = null;
		this.receipt = null;
		if (!selection || selection.document !== document) return;
		const base = {
			document,
			sequence: event.sequence,
			revision: event.revision,
			expectedSelection: selection,
		};
		if (
			prepared?.document === document &&
			event.kind === "edit" &&
			event.sequence === prepared.sequence + 1 &&
			event.baseRevision === prepared.revision &&
			sameEndpoint(selection.endpoint, prepared.before)
		) {
			const sourceChange = event.changes.find(
				({ x, y }) => x === prepared.before.cell.x && y === prepared.before.cell.y,
			);
			const targetChange = event.changes.find(
				({ x, y }) => x === prepared.target.x && y === prepared.target.y,
			);
			const targetRail = document.map.getRail(prepared.target.x, prepared.target.y);
			if (
				sourceChange?.before === prepared.before.encoded &&
				targetChange?.after === encodeRailCell(targetRail) &&
				classifyRailCell(targetRail) === "TERMINAL"
			) {
				this.pending = {
					...base,
					kind: "apply",
					before: prepared.before,
					target: prepared.target,
					encoded: targetChange.after,
					forward: railPatchTransitionFingerprint(event),
					reverse: railPatchTransitionFingerprint(event, true),
				};
			}
			return;
		}
		if ((event.kind !== "undo" && event.kind !== "redo") || event.historyOriginKind !== "edit")
			return;
		const undo = event.kind === "undo";
		if (
			receipt?.document === document &&
			event.sequence === receipt.sequence + 1 &&
			receipt.phase === (undo ? "applied" : "undone") &&
			sameEndpoint(selection.endpoint, undo ? receipt.after : receipt.before) &&
			railPatchTransitionFingerprint(event) === (undo ? receipt.reverse : receipt.forward)
		) {
			this.pending = {
				...base,
				kind: "replay",
				receipt: { ...receipt, sequence: event.sequence, phase: undo ? "undone" : "applied" },
				target: undo ? receipt.before : receipt.after,
			};
		} else if (selection.endpoint) {
			// Older/unrelated history cannot turn a selected endpoint into an arbitrary straight.
			this.pending = { ...base, kind: "guard", target: selection.endpoint };
		}
	}

	/** Consume only the exact newly derived model, before generic exact-ID reconciliation. */
	publish(
		document: RailDocument,
		map: TileMap,
		index: RailModuleOwnershipIndex,
	): EndpointSelectionProjection {
		const pending = this.pending;
		this.pending = null;
		if (!pending) return null;
		if (
			pending.document !== document ||
			!sameSelection(this.selection, pending.expectedSelection)
		) {
			this.receipt = null;
			return null;
		}
		if (
			pending.sequence !== document.getPatchSequence() ||
			pending.revision !== map.getRevision() ||
			map !== document.map
		) {
			this.receipt = null;
			return "clear";
		}
		const target = pending.kind === "apply" ? pending.target : pending.target.cell;
		const endpoint = endpointSelection(
			map,
			index,
			target,
			pending.kind === "apply" ? null : pending.target.moduleKey,
		);
		if (
			!endpoint ||
			(pending.kind === "apply"
				? endpoint.encoded !== pending.encoded
				: !sameEndpoint(endpoint, pending.target))
		) {
			this.receipt = null;
			return "clear";
		}
		const module = index.find(endpoint.moduleKey);
		if (!module) return "clear";
		if (pending.kind === "apply") {
			this.receipt = {
				document,
				sequence: pending.sequence,
				phase: "applied",
				before: pending.before,
				after: endpoint,
				forward: pending.forward,
				reverse: pending.reverse,
			};
		} else if (pending.kind === "replay") this.receipt = pending.receipt;
		this.selection = { document, cell: endpoint.cell, moduleKey: endpoint.moduleKey, endpoint };
		return { cell: endpoint.cell, module };
	}
}
