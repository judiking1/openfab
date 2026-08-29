import type { AuthoredRailType } from "../core/RailCellClassification";
import {
	RAIL_TEMPLATE_CATALOG,
	type RailTemplateCatalogItem,
	type RailTemplateCategory,
} from "../core/RailTemplateCatalog";

export interface RailTemplateSelectionContext {
	readonly mapEmpty: boolean;
	readonly selectedRailType: AuthoredRailType | null;
	readonly selectedOpenTerminal: boolean;
}

/**
 * The persistent Advanced gallery owns only motifs that can start in empty space. Templates that
 * mutate an existing trunk or terminal remain catalog-owned, but are disclosed at their anchor.
 */
export function assemblyRailTemplateGallery(
	category: RailTemplateCategory,
): readonly RailTemplateCatalogItem[] {
	return RAIL_TEMPLATE_CATALOG.filter(
		(item) => item.category === category && item.anchorRequirement === "free-closed",
	);
}

/** Keep specialized repair/attachment tools out of the flat gallery until their anchor exists. */
export function contextualRailTemplates(
	context: RailTemplateSelectionContext,
): readonly RailTemplateCatalogItem[] {
	return RAIL_TEMPLATE_CATALOG.filter((item) => {
		if (item.anchorRequirement === "directed-straight-trunk") {
			return context.selectedRailType === "LINEAR";
		}
		if (item.anchorRequirement === "empty-or-open-terminal") {
			return context.mapEmpty || context.selectedOpenTerminal;
		}
		return false;
	});
}
