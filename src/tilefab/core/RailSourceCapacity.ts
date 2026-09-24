import {
	type AdvancedSwitchMutation,
	advancedSwitchEquals,
	advancedSwitchRecordError,
} from "./AdvancedSwitch";
import {
	assertPortSlotRowBudget,
	assertRailGeometryBudget,
	OPENFAB_PORT_SLOT_POLICIES,
} from "./PortSlotPolicy";
import { classifyRailCell } from "./RailCellClassification";
import { cellKey, decodeRailCell, type TileMap, type TileMapCellMutation } from "./TileMap";

export interface RailSourceCounts {
	readonly sourcePaths: number;
	readonly cardinalLinearSources: number;
}

const CELL_SOURCE_COUNTS = Array.from({ length: 256 }, (_, encoded): RailSourceCounts => {
	const kind = classifyRailCell(decodeRailCell(encoded));
	return {
		sourcePaths: encoded === 0 ? 0 : kind === "BRANCH" || kind === "MERGE" ? 2 : 1,
		cardinalLinearSources: kind === "LINEAR" ? 1 : 0,
	};
});
// Two inputs, a shared trunk, two outputs. Suppressed cardinal sources remain in remap metadata.
const SOURCES_PER_ADVANCED_SWITCH = 5;

/** Exact source metadata counts, independent of map size. Geometry/interval limits remain separate. */
export function railSourceCounts(map: TileMap): RailSourceCounts {
	let sourcePaths = map.advancedSwitchCount * SOURCES_PER_ADVANCED_SWITCH;
	let cardinalLinearSources = 0;
	for (let encoded = 1; encoded < 256; encoded++) {
		const count = map.getEncodedCellCount(encoded);
		const contribution = CELL_SOURCE_COUNTS[encoded] as RailSourceCounts;
		sourcePaths += count * contribution.sourcePaths;
		cardinalLinearSources += count * contribution.cardinalLinearSources;
	}
	return { sourcePaths, cardinalLinearSources };
}

export function assertRailSourceCapacity(map: TileMap): void {
	assertSourceCounts(railSourceCounts(map));
}

/** Preview only. The document independently checks its unpublished final candidate before commit. */
export function railSourceCapacityError(
	map: TileMap,
	changes: readonly TileMapCellMutation[],
	switchChanges: readonly AdvancedSwitchMutation[] = [],
): string | null {
	try {
		let { sourcePaths, cardinalLinearSources } = railSourceCounts(map);
		const cells = new Set<string>();
		for (const { x, y, before, after } of changes) {
			const key = cellKey(x, y);
			if (
				!Number.isSafeInteger(x) ||
				!Number.isSafeInteger(y) ||
				!Number.isInteger(before) ||
				before < 0 ||
				before > 255 ||
				!Number.isInteger(after) ||
				after < 0 ||
				after > 255 ||
				cells.has(key) ||
				map.getEncoded(x, y) !== before
			)
				throw new Error("레일 변경 원본이 현재 맵과 다릅니다. 다시 그려 주세요.");
			cells.add(key);
			const previous = CELL_SOURCE_COUNTS[before] as RailSourceCounts;
			const next = CELL_SOURCE_COUNTS[after] as RailSourceCounts;
			sourcePaths += next.sourcePaths - previous.sourcePaths;
			cardinalLinearSources += next.cardinalLinearSources - previous.cardinalLinearSources;
		}
		const switches = new Set<number>();
		for (const { id, before, after } of switchChanges) {
			if (
				switches.has(id) ||
				(!before && !after) ||
				(before && (before.id !== id || advancedSwitchRecordError(before))) ||
				(after && (after.id !== id || advancedSwitchRecordError(after))) ||
				!advancedSwitchEquals(map.getAdvancedSwitch(id) ?? null, before)
			)
				throw new Error("고급 분기 변경 원본이 현재 맵과 다릅니다. 다시 그려 주세요.");
			switches.add(id);
			sourcePaths +=
				(Number(after !== null) - Number(before !== null)) * SOURCES_PER_ADVANCED_SWITCH;
		}
		assertSourceCounts({ sourcePaths, cardinalLinearSources });
		return null;
	} catch (error) {
		return error instanceof Error ? error.message : "레일 배치 규모를 확인할 수 없습니다.";
	}
}

function assertSourceCounts(counts: RailSourceCounts): void {
	assertRailGeometryBudget(counts.sourcePaths);
	for (const policy of Object.values(OPENFAB_PORT_SLOT_POLICIES)) {
		assertPortSlotRowBudget(counts.cardinalLinearSources * policy.sides.length);
	}
}
