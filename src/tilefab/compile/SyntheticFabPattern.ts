import { createRailAreaSelection, type RailAreaSelection } from "../core/RailAreaSelection";
import { createRailAreaStampTemplate, type RailAreaStampTemplate } from "../core/RailAreaStamp";
import { buildRailModuleOwnershipIndex } from "../core/RailModuleOwnership";
import {
	buildSyntheticFabStarter,
	SYNTHETIC_FAB_STARTER_CATALOG,
	type SyntheticFabStarterBuild,
	type SyntheticFabStarterCatalogItem,
	type SyntheticFabStarterRequest,
} from "./SyntheticFabStarter";

export const SYNTHETIC_FAB_PATTERN_CATALOG: readonly SyntheticFabStarterCatalogItem[] =
	Object.freeze(
		SYNTHETIC_FAB_STARTER_CATALOG.filter(
			(item) => item.id === "bay-assembly" || item.id === "bay-bank",
		),
	);

export interface SyntheticFabPatternBuild {
	readonly starter: SyntheticFabStarterBuild;
	readonly selection: RailAreaSelection;
	readonly template: RailAreaStampTemplate;
}

/**
 * Compile a synthetic whole-FAB definition into the ordinary transient area-stamp grammar.
 * Placement, rotation, flow reversal, undo/redo, and Worker mirroring remain owned by the
 * existing rail-authoring pipeline.
 */
export function buildSyntheticFabPattern(
	request: SyntheticFabStarterRequest,
): SyntheticFabPatternBuild {
	if (
		request.id === "complete-fab" ||
		request.id === "large-fab-60" ||
		request.id === "production-fab-60"
	) {
		throw new Error(
			"완성 FAB는 새 프로젝트 Factory Starter로 시작한 뒤 필요한 구역을 청사진으로 저장하세요",
		);
	}
	const starter = buildSyntheticFabStarter(request);
	const bounds = starter.summary.bounds;
	if (!bounds || starter.analysis.cells === 0) {
		throw new Error("빈 격자는 현재 맵에 FAB 패턴으로 배치할 수 없습니다");
	}

	const ownership = buildRailModuleOwnershipIndex(starter.document.map);
	const selection = createRailAreaSelection(
		ownership,
		{ x: bounds.minX, y: bounds.minY },
		{ x: bounds.maxX, y: bounds.maxY },
		"fully-contained",
	);
	const template = createRailAreaStampTemplate(selection);
	if (template.sourceEdgeCount !== starter.analysis.edges) {
		throw new Error(
			`FAB 패턴 변환에서 ${starter.analysis.edges - template.sourceEdgeCount}개의 directed edge가 누락되었습니다`,
		);
	}

	return Object.freeze({ starter, selection, template });
}
