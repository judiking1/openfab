import type { AdvancedSwitchRecord } from "./AdvancedSwitch";
import type { RailMapReader, RailMutation } from "./paint";
import { bitCount } from "./railShape";
import { cellKey, decodeRailCell, type RailCell } from "./TileMap";

/** Sparse future-state reader used to compose several rail plans without cloning a TileMap. */
export class MutationRailMap implements RailMapReader {
	private readonly source: RailMapReader;
	private readonly encodedByCell: Map<string, number>;
	private currentEdgeCount: number;

	constructor(
		source: RailMapReader,
		encodedByCell = new Map<string, number>(),
		edgeCount = source.edgeCount,
	) {
		this.source = source;
		this.encodedByCell = encodedByCell;
		this.currentEdgeCount = edgeCount;
	}

	get edgeCount(): number {
		return this.currentEdgeCount;
	}

	getRevision(): number {
		return this.source.getRevision();
	}

	getEncoded(x: number, y: number): number {
		return this.encodedByCell.get(cellKey(x, y)) ?? this.source.getEncoded(x, y);
	}

	getRail(x: number, y: number): RailCell {
		return decodeRailCell(this.getEncoded(x, y));
	}

	hasRail(x: number, y: number): boolean {
		return this.getEncoded(x, y) !== 0;
	}

	getAdvancedSwitch(id: number): AdvancedSwitchRecord | undefined {
		return this.source.getAdvancedSwitch(id);
	}

	getAdvancedSwitchOwningCell(x: number, y: number): AdvancedSwitchRecord | undefined {
		return this.source.getAdvancedSwitchOwningCell(x, y);
	}

	setEncoded(x: number, y: number, encoded: number): boolean {
		const next = encoded & 0xff;
		const before = this.getEncoded(x, y);
		if (before === next) return false;
		this.encodedByCell.set(cellKey(x, y), next);
		this.currentEdgeCount +=
			bitCount(decodeRailCell(next).outgoing) - bitCount(decodeRailCell(before).outgoing);
		return true;
	}

	apply(mutations: readonly RailMutation[]): void {
		for (const mutation of mutations) this.setEncoded(mutation.x, mutation.y, mutation.after);
	}

	/** Collapse intermediate writes into one deterministic source-before/final-after mutation. */
	mutations(): readonly RailMutation[] {
		const result: RailMutation[] = [];
		for (const [key, after] of this.encodedByCell) {
			const separator = key.indexOf(",");
			const x = Number(key.slice(0, separator));
			const y = Number(key.slice(separator + 1));
			const before = this.source.getEncoded(x, y);
			if (before !== after) result.push({ x, y, before, after });
		}
		result.sort((left, right) => left.y - right.y || left.x - right.x);
		return Object.freeze(result.map((mutation) => Object.freeze(mutation)));
	}

	clone(): MutationRailMap {
		return new MutationRailMap(this.source, new Map(this.encodedByCell), this.currentEdgeCount);
	}
}
