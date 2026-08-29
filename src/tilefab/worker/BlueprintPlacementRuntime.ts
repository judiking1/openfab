import { compilePhysicalRail } from "../compile/PhysicalRailCompiler";
import { resolvePortAttachment } from "../compile/PortAttachmentResolver";
import { RailDraftEvaluator } from "../compile/RailDraftEvaluator";
import { applyPortEquipmentMutations } from "../core/EquipmentGroup";
import { planRailAreaStamp, type RailAreaStampPlan } from "../core/RailAreaStamp";
import {
	planStaticFabBlueprintPlacement,
	type StaticFabMutationPlan,
} from "../core/StaticFabBlueprint";
import type { Cell } from "../core/TileMap";
import {
	BLUEPRINT_PLACEMENT_CONFLICT_LIMIT,
	BLUEPRINT_PLACEMENT_INVALID_PLAN_SAMPLE_LIMIT,
	type PrepareBlueprintPlacementRequest,
	type PreparedBlueprintPlacement,
} from "./BlueprintPlacementProtocol";
import { hydrateRailMirrorSnapshotDocument } from "./RailMirrorSnapshotDocument";

export type BlueprintPlacementClock = () => number;

/**
 * Exact factory-blueprint planning and physical validation. Production calls this only inside the
 * disposable placement Worker; keeping it pure makes revision and commit contracts testable.
 */
export function prepareBlueprintPlacement(
	request: PrepareBlueprintPlacementRequest,
	now: BlueprintPlacementClock = () => performance.now(),
): PreparedBlueprintPlacement {
	const source = hydrateRailMirrorSnapshotDocument(request.snapshot);
	const planningStartedAt = now();
	const plan = request.staticFabTemplate
		? planStaticFabBlueprintPlacement(
				source.map,
				source.portEquipment,
				source.getPatchSequence(),
				request.staticFabTemplate,
				request.anchor,
				request.pose,
			)
		: planRailAreaStamp(source.map, request.railTemplate, request.anchor, request.pose);
	const planningMilliseconds = now() - planningStartedAt;
	if (!plan.valid) {
		return placementResult(
			request,
			plan,
			false,
			plan.reason,
			plan.conflicts,
			planningMilliseconds,
			0,
		);
	}

	const validationStartedAt = now();
	const committed = compilePhysicalRail(source.map);
	const evaluation = new RailDraftEvaluator().evaluate(
		source.map,
		committed,
		plan,
		source.portEquipment,
	);
	if (evaluation.valid && "staticFab" in plan) {
		try {
			const prospectiveMap = source.map.clone();
			if (!prospectiveMap.applyAtomicMutations(plan.mutations, plan.switchMutations ?? [])) {
				throw new Error("레일 또는 switch mutation의 before 상태가 스냅샷과 일치하지 않습니다");
			}
			const prospectiveEquipment = applyPortEquipmentMutations(
				source.portEquipment,
				plan.portMutations,
				plan.equipmentGroupMutations,
			);
			const prospectiveLayout = compilePhysicalRail(prospectiveMap);
			for (const port of prospectiveEquipment.ports) {
				const attachment = resolvePortAttachment(prospectiveLayout, port);
				if (attachment.ok) continue;
				const conflictCells =
					port.route.kind === "CARDINAL_CELL"
						? [Object.freeze({ x: port.route.x, y: port.route.z })]
						: [];
				return placementResult(
					request,
					plan,
					false,
					`PORT-${port.id} physical attachment is invalid (${attachment.code}): ${attachment.message}`,
					conflictCells,
					planningMilliseconds,
					now() - validationStartedAt,
				);
			}
		} catch (error) {
			return placementResult(
				request,
				plan,
				false,
				error instanceof Error
					? error.message
					: "혼합 청사진의 prospective 물리 상태를 검증할 수 없습니다",
				plan.conflicts,
				planningMilliseconds,
				now() - validationStartedAt,
			);
		}
	}
	const validationMilliseconds = now() - validationStartedAt;
	return placementResult(
		request,
		plan,
		evaluation.valid,
		evaluation.reason,
		evaluation.conflictCells,
		planningMilliseconds,
		validationMilliseconds,
	);
}

function placementResult(
	request: PrepareBlueprintPlacementRequest,
	plan: RailAreaStampPlan | StaticFabMutationPlan,
	valid: boolean,
	reason: string,
	conflicts: readonly Cell[],
	planningMilliseconds: number,
	validationMilliseconds: number,
): PreparedBlueprintPlacement {
	const responsePlan = valid ? plan : compactInvalidPlacementPlan(plan);
	return Object.freeze({
		sourceRevision: request.snapshot.revision,
		sourcePatchSequence: request.snapshot.sequence,
		sourceChecksum: request.snapshot.checksum,
		plan: responsePlan,
		valid,
		reason,
		conflictCells: Object.freeze(
			sampleArray(conflicts, BLUEPRINT_PLACEMENT_CONFLICT_LIMIT).map((cell) =>
				Object.freeze({ x: cell.x, y: cell.y }),
			),
		),
		conflictCount: conflicts.length,
		planningMilliseconds,
		validationMilliseconds,
	});
}

function compactInvalidPlacementPlan(
	plan: RailAreaStampPlan | StaticFabMutationPlan,
): RailAreaStampPlan | StaticFabMutationPlan {
	if (!("staticFab" in plan)) return compactRailAreaStampPlan(plan);

	const railPlan = compactRailAreaStampPlan(plan.railPlan);
	return Object.freeze({
		...plan,
		cells: railPlan.cells,
		mutations: railPlan.mutations,
		...(railPlan.switchMutations ? { switchMutations: railPlan.switchMutations } : {}),
		conflicts: sampleArray(plan.conflicts, BLUEPRINT_PLACEMENT_INVALID_PLAN_SAMPLE_LIMIT),
		railPlan,
		portMutations: Object.freeze([]),
		equipmentGroupMutations: Object.freeze([]),
		staticFab: Object.freeze({
			...plan.staticFab,
			portPreviews: sampleArray(
				plan.staticFab.portPreviews,
				BLUEPRINT_PLACEMENT_INVALID_PLAN_SAMPLE_LIMIT,
			),
		}),
	});
}

function compactRailAreaStampPlan(plan: RailAreaStampPlan): RailAreaStampPlan {
	return Object.freeze({
		...plan,
		cells: sampleArray(plan.cells, BLUEPRINT_PLACEMENT_INVALID_PLAN_SAMPLE_LIMIT),
		mutations: sampleArray(plan.mutations, BLUEPRINT_PLACEMENT_INVALID_PLAN_SAMPLE_LIMIT),
		...(plan.switchMutations
			? {
					switchMutations: sampleArray(
						plan.switchMutations,
						BLUEPRINT_PLACEMENT_INVALID_PLAN_SAMPLE_LIMIT,
					),
				}
			: {}),
		conflicts: sampleArray(plan.conflicts, BLUEPRINT_PLACEMENT_INVALID_PLAN_SAMPLE_LIMIT),
	});
}

function sampleArray<T>(values: readonly T[], limit: number): readonly T[] {
	if (values.length <= limit) return values;
	const lastIndex = values.length - 1;
	return Object.freeze(
		Array.from({ length: limit }, (_, sampleIndex) => {
			const sourceIndex = Math.floor((sampleIndex * lastIndex) / (limit - 1));
			return values[sourceIndex] as T;
		}),
	);
}
