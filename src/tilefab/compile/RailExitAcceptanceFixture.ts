import { OrderedTypedChecksum } from "../core/OrderedTypedChecksum";
import { planOffsetStraight } from "../core/edit";
import { RailDocument, type RailPatchEvent } from "../core/RailDocument";
import {
	initialRailTemplatePose,
	planRailTemplate,
	type BranchBypassTemplateParameters,
	type LongBayTemplateParameters,
} from "../core/RailTemplateCatalog";
import { DIR_E } from "../core/railShape";
import type { Cell } from "../core/TileMap";
import { compilePhysicalRail } from "./PhysicalRailCompiler";
import { RailDraftEvaluator } from "./RailDraftEvaluator";

export const RAIL_EXIT_ACCEPTANCE_FIXTURE_VERSION = 1;

export interface RailExitAcceptanceFixtureDefinition {
	readonly version: typeof RAIL_EXIT_ACCEPTANCE_FIXTURE_VERSION;
	readonly id: "OPENFAB_RAIL_EXIT_V1";
	readonly bayAnchor: Cell;
	readonly bay: LongBayTemplateParameters;
	readonly bypassAnchor: Cell;
	readonly bypass: BranchBypassTemplateParameters;
	readonly reshapeSelected: Cell;
	readonly reshapeTarget: Cell;
	readonly definitionFingerprint: string;
}

export interface RailExitAcceptanceFixture {
	readonly definition: RailExitAcceptanceFixtureDefinition;
	readonly document: RailDocument;
	readonly patches: readonly RailPatchEvent[];
}

const BAY_ANCHOR = Object.freeze({ x: 0, y: 0 });
const BYPASS_ANCHOR = Object.freeze({ x: 8, y: 0 });
const RESHAPE_SELECTED = Object.freeze({ x: 0, y: 5 });
const RESHAPE_TARGET = Object.freeze({ x: 3, y: 5 });
const BAY_PARAMETERS: LongBayTemplateParameters = Object.freeze({
	templateId: "long-bay",
	aisleLengthMeters: 40,
	laneSpacingMeters: 12,
	clearanceProfileId: "OPENFAB_COMPACT_AMHS_CLEARANCE_V1",
});
const BYPASS_PARAMETERS: BranchBypassTemplateParameters = Object.freeze({
	templateId: "branch-bypass",
	trunkSpanMeters: 12,
	offsetMeters: 4,
	clearanceProfileId: "OPENFAB_COMPACT_AMHS_CLEARANCE_V1",
});

export const RAIL_EXIT_ACCEPTANCE_FIXTURE: RailExitAcceptanceFixtureDefinition = (() => {
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings([
		"OPENFAB_RAIL_EXIT_V1",
		BAY_PARAMETERS.templateId,
		BAY_PARAMETERS.clearanceProfileId,
		BYPASS_PARAMETERS.templateId,
		BYPASS_PARAMETERS.clearanceProfileId,
	]);
	checksum.addNumbers([
		RAIL_EXIT_ACCEPTANCE_FIXTURE_VERSION,
		BAY_ANCHOR.x,
		BAY_ANCHOR.y,
		BAY_PARAMETERS.aisleLengthMeters,
		BAY_PARAMETERS.laneSpacingMeters,
		BYPASS_ANCHOR.x,
		BYPASS_ANCHOR.y,
		BYPASS_PARAMETERS.trunkSpanMeters,
		BYPASS_PARAMETERS.offsetMeters,
		RESHAPE_SELECTED.x,
		RESHAPE_SELECTED.y,
		RESHAPE_TARGET.x,
		RESHAPE_TARGET.y,
	]);
	return Object.freeze({
		version: RAIL_EXIT_ACCEPTANCE_FIXTURE_VERSION,
		id: "OPENFAB_RAIL_EXIT_V1",
		bayAnchor: BAY_ANCHOR,
		bay: BAY_PARAMETERS,
		bypassAnchor: BYPASS_ANCHOR,
		bypass: BYPASS_PARAMETERS,
		reshapeSelected: RESHAPE_SELECTED,
		reshapeTarget: RESHAPE_TARGET,
		definitionFingerprint: checksum.digest(),
	});
})();

/** Builds the canonical Phase 1 world through the same planners and evaluator used by the editor. */
export function buildRailExitAcceptanceFixture(): RailExitAcceptanceFixture {
	const document = new RailDocument();
	const patches: RailPatchEvent[] = [];
	document.subscribe((patch) => patches.push(patch));
	const evaluator = new RailDraftEvaluator();

	const bay = planRailTemplate(
		document.map,
		"long-bay",
		RAIL_EXIT_ACCEPTANCE_FIXTURE.bayAnchor,
		initialRailTemplatePose(),
		RAIL_EXIT_ACCEPTANCE_FIXTURE.bay,
	);
	commitFixturePlan(document, evaluator, bay, "Long Bay");

	const bypass = planRailTemplate(
		document.map,
		"branch-bypass",
		RAIL_EXIT_ACCEPTANCE_FIXTURE.bypassAnchor,
		{ forward: DIR_E, side: "left" },
		RAIL_EXIT_ACCEPTANCE_FIXTURE.bypass,
	);
	commitFixturePlan(document, evaluator, bypass, "tangent bypass");

	const reshape = planOffsetStraight(
		document.map,
		RAIL_EXIT_ACCEPTANCE_FIXTURE.reshapeSelected,
		RAIL_EXIT_ACCEPTANCE_FIXTURE.reshapeTarget,
	);
	commitFixturePlan(document, evaluator, reshape, "straight offset compound");

	return Object.freeze({
		definition: RAIL_EXIT_ACCEPTANCE_FIXTURE,
		document,
		patches: Object.freeze([...patches]),
	});
}

function commitFixturePlan(
	document: RailDocument,
	evaluator: RailDraftEvaluator,
	plan: Parameters<RailDraftEvaluator["evaluate"]>[2],
	label: string,
): void {
	if (!plan.valid) throw new Error(`Rail exit fixture ${label} planning failed: ${plan.reason}`);
	const physical = compilePhysicalRail(document.map);
	const evaluation = evaluator.evaluate(document.map, physical, plan);
	if (!evaluation.valid) {
		throw new Error(`Rail exit fixture ${label} evaluation failed: ${evaluation.reason}`);
	}
	if (!document.commit(evaluation.plan)) {
		throw new Error(`Rail exit fixture ${label} could not be committed atomically.`);
	}
}
