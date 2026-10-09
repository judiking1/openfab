import { classifyRailCell } from "../core/RailCellClassification";
import type { RailDocument, RailPatchEvent } from "../core/RailDocument";
import type { RailModuleOwnership, RailModuleOwnershipIndex } from "../core/RailModuleOwnership";
import { railPatchTransitionFingerprint } from "../core/RailPatchHistory";
import { DIR_E, DIR_W } from "../core/railShape";
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

export type RailReshapeKind = "endpoint" | "corner" | "straight";

interface ReshapeSelection {
	readonly kind: RailReshapeKind;
	readonly cell: Cell;
	readonly moduleKey: string;
	readonly encoded: number;
}

interface SelectionIdentity {
	readonly document: RailDocument;
	readonly cell: Cell;
	readonly moduleKey: string | null;
	readonly anchor: ReshapeSelection | null;
}

interface ReshapeMoveReceipt {
	readonly document: RailDocument;
	readonly sequence: number;
	readonly phase: "applied" | "undone";
	readonly before: ReshapeSelection;
	readonly after: ReshapeSelection;
	readonly forward: string;
	readonly reverse: string;
}

interface PreparedReshapeMove {
	readonly document: RailDocument;
	readonly sequence: number;
	readonly revision: number;
	readonly before: ReshapeSelection;
	readonly target: Cell;
}

type PendingReshapeSelection = Readonly<{
	document: RailDocument;
	sequence: number;
	revision: number;
	expectedSelection: SelectionIdentity;
}> &
	(
		| Readonly<{
				kind: "apply";
				before: ReshapeSelection;
				target: Cell;
				encoded: number;
				forward: string;
				reverse: string;
		  }>
		| Readonly<{ kind: "replay"; receipt: ReshapeMoveReceipt; target: ReshapeSelection }>
		| Readonly<{ kind: "guard"; target: ReshapeSelection }>
	);

export type ReshapeSelectionProjection =
	| Readonly<{ cell: Cell; module: RailModuleOwnership }>
	| "clear"
	| null;

function reshapeSelection(
	map: TileMap,
	index: RailModuleOwnershipIndex,
	cell: Cell,
	moduleKey?: string | null,
): ReshapeSelection | null {
	if (index.revision !== map.getRevision()) return null;
	const rail = map.getRail(cell.x, cell.y);
	const kind = reshapeKind(map, cell);
	if (!kind || map.getAdvancedSwitchOwningCell(cell.x, cell.y)) return null;
	const resolved = index.resolve(cell);
	if (resolved.status !== "resolved" || (moduleKey != null && resolved.module.key !== moduleKey))
		return null;
	return { kind, cell: { ...cell }, moduleKey: resolved.module.key, encoded: encodeRailCell(rail) };
}

/** Identity proof only: the next edit still needs its existing source/target admission checks. */
function reshapeKind(map: TileMap, cell: Cell): RailReshapeKind | null {
	const type = classifyRailCell(map.getRail(cell.x, cell.y));
	if (type === "TERMINAL") return "endpoint";
	if (type === "LEFT_CURVE" || type === "RIGHT_CURVE") return "corner";
	return type === "LINEAR" ? "straight" : null;
}

function sameAnchor(left: ReshapeSelection | null, right: ReshapeSelection | null): boolean {
	return Boolean(
		left &&
			right &&
			left.kind === right.kind &&
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

/** Runtime-only correspondence for the latest ordinary reshape; it never changes authored data. */
export class ReshapeSelectionHistory {
	private selection: SelectionIdentity | null = null;
	private prepared: PreparedReshapeMove | null = null;
	private pending: PendingReshapeSelection | null = null;
	private receipt: ReshapeMoveReceipt | null = null;

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
					anchor: reshapeSelection(map, index, cell, moduleKey),
				}
			: null;
		if (!next || !sameSelection(this.selection, next)) {
			this.receipt = null;
			this.pending = null;
			this.prepared = null;
		}
		this.selection = next;
	}

	prepareMove(
		document: RailDocument,
		pointerTarget: Cell,
		kind: RailReshapeKind = "endpoint",
	): void {
		const before = this.selection?.anchor;
		const sourceRail = before ? document.map.getRail(before.cell.x, before.cell.y) : null;
		// The straight planner ignores displacement along the original rail axis.
		const target =
			before && sourceRail && kind === "straight"
				? sourceRail.outgoing === DIR_E || sourceRail.outgoing === DIR_W
					? { x: before.cell.x, y: pointerTarget.y }
					: { x: pointerTarget.x, y: before.cell.y }
				: pointerTarget;
		this.prepared =
			before &&
			before.kind === kind &&
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
			sameAnchor(selection.anchor, prepared.before)
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
				reshapeKind(document.map, prepared.target) === prepared.before.kind
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
			sameAnchor(selection.anchor, undo ? receipt.after : receipt.before) &&
			railPatchTransitionFingerprint(event) === (undo ? receipt.reverse : receipt.forward)
		) {
			this.pending = {
				...base,
				kind: "replay",
				receipt: { ...receipt, sequence: event.sequence, phase: undo ? "undone" : "applied" },
				target: undo ? receipt.before : receipt.after,
			};
		} else if (selection.anchor) {
			// Older/unrelated history may retain only the exact cell, kind, ports and ownership.
			this.pending = { ...base, kind: "guard", target: selection.anchor };
		}
	}

	/** Consume only the exact newly derived model, before generic exact-ID reconciliation. */
	publish(
		document: RailDocument,
		map: TileMap,
		index: RailModuleOwnershipIndex,
	): ReshapeSelectionProjection {
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
		const anchor = reshapeSelection(
			map,
			index,
			target,
			pending.kind === "apply" ? null : pending.target.moduleKey,
		);
		if (
			!anchor ||
			(pending.kind === "apply"
				? anchor.kind !== pending.before.kind || anchor.encoded !== pending.encoded
				: !sameAnchor(anchor, pending.target))
		) {
			this.receipt = null;
			return "clear";
		}
		const module = index.find(anchor.moduleKey);
		if (!module) return "clear";
		if (pending.kind === "apply") {
			this.receipt = {
				document,
				sequence: pending.sequence,
				phase: "applied",
				before: pending.before,
				after: anchor,
				forward: pending.forward,
				reverse: pending.reverse,
			};
		} else if (pending.kind === "replay") this.receipt = pending.receipt;
		this.selection = { document, cell: anchor.cell, moduleKey: anchor.moduleKey, anchor };
		return { cell: anchor.cell, module };
	}
}
