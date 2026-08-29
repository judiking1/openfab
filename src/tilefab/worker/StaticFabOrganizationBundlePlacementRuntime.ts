import { compilePhysicalRail } from "../compile/PhysicalRailCompiler";
import { resolvePortAttachment } from "../compile/PortAttachmentResolver";
import { RailDraftEvaluator } from "../compile/RailDraftEvaluator";
import { prepareStaticFabOrganizationBundle } from "../core/StaticFabOrganizationBundle";
import {
	planStaticFabOrganizationBundlePlacementWithProspectiveState,
	type StaticFabOrganizationBundlePlacementPlan,
	staticFabOrganizationBundleFingerprint,
	staticFabOrganizationBundlePlacementFingerprint,
} from "../core/StaticFabOrganizationBundlePlacement";
import type { Cell } from "../core/TileMap";
import { checksumRailMap } from "./RailMirrorChecksum";
import { hydrateRailMirrorSnapshotDocument } from "./RailMirrorSnapshotDocument";
import {
	type PreparedStaticFabOrganizationBundlePlacement,
	type PrepareStaticFabOrganizationBundlePlacementRequest,
	STATIC_FAB_ORGANIZATION_BUNDLE_CONFLICT_LIMIT,
	type StaticFabOrganizationBundlePlacementFailureCode,
} from "./StaticFabOrganizationBundlePlacementProtocol";

export type StaticFabOrganizationBundlePlacementClock = () => number;

/** Exact organization-bundle planning and validation used only inside a disposable Worker. */
export function prepareStaticFabOrganizationBundlePlacement(
	request: PrepareStaticFabOrganizationBundlePlacementRequest,
	now: StaticFabOrganizationBundlePlacementClock = () => performance.now(),
): PreparedStaticFabOrganizationBundlePlacement {
	let source: ReturnType<typeof hydrateRailMirrorSnapshotDocument>;
	try {
		source = hydrateRailMirrorSnapshotDocument(request.snapshot);
	} catch (error) {
		return rejected(
			null,
			"snapshot",
			caughtMessage(error, "레일 스냅샷을 복원할 수 없습니다"),
			[],
			0,
			0,
			0,
			0,
		);
	}

	const preparedBundle = prepareStaticFabOrganizationBundle(request.bundle);
	if (!preparedBundle.valid) {
		return rejected(null, "bundle", preparedBundle.reason, [], 0, 0, 0, 0);
	}
	let bundleFingerprint: string;
	try {
		bundleFingerprint = staticFabOrganizationBundleFingerprint(preparedBundle.bundle);
	} catch (error) {
		return rejected(
			null,
			"fingerprint",
			caughtMessage(error, "조직 청사진 지문을 계산할 수 없습니다"),
			[],
			0,
			0,
			0,
			0,
		);
	}
	if (bundleFingerprint !== request.expectedBundleFingerprint) {
		return rejected(
			null,
			"fingerprint",
			"조직 청사진이 Worker 전송 중 변경되었습니다",
			[],
			0,
			0,
			0,
			0,
		);
	}

	const planningStartedAt = now();
	const planning = planStaticFabOrganizationBundlePlacementWithProspectiveState(
		source.map,
		source.portEquipment,
		source.getPatchSequence(),
		source.organizations,
		preparedBundle.bundle,
		request.anchor,
		request.quarterTurns,
		request.snapshot.checksum,
	);
	const plan = planning.plan;
	const planningMilliseconds = now() - planningStartedAt;
	if (!plan.valid) {
		return rejected(
			compactRejectedPlan(plan, plan.reason, plan.conflicts),
			"plan",
			plan.reason,
			plan.conflicts,
			0,
			0,
			planningMilliseconds,
			0,
		);
	}
	if (
		plan.baseRevision !== request.snapshot.revision ||
		plan.basePatchSequence !== request.snapshot.sequence ||
		plan.nextOrganizationIdBefore !== source.organizations.nextOrganizationId
	) {
		return rejected(
			compactRejectedPlan(plan, "조직 청사진 배치 세대가 변경되었습니다", []),
			"stale",
			"조직 청사진 배치 plan과 레일 스냅샷의 세대가 일치하지 않습니다",
			[],
			0,
			0,
			planningMilliseconds,
			0,
		);
	}
	if (!planning.prospectiveState) {
		return rejected(
			compactRejectedPlan(plan, "조직 청사진 prospective 상태가 누락되었습니다", []),
			"plan",
			"조직 청사진 배치 plan의 prospective 상태가 누락되었습니다",
			[],
			0,
			0,
			planningMilliseconds,
			0,
		);
	}

	const validationStartedAt = now();
	let prospectiveChecksum: string;
	let prospectiveNextAdvancedSwitchId: number;
	let prospectiveNextPortId: number;
	let prospectiveNextEquipmentGroupId: number;
	let prospectiveNextOrganizationId: number;
	try {
		const {
			map: prospectiveMap,
			portEquipment: prospectiveEquipment,
			organizations: prospectiveOrganizations,
		} = planning.prospectiveState;
		if (prospectiveEquipment.ports.length > 0) {
			const prospectiveLayout = compilePhysicalRail(prospectiveMap);
			for (const port of prospectiveEquipment.ports) {
				const attachment = resolvePortAttachment(prospectiveLayout, port);
				if (!attachment.ok) {
					throw new Error(
						`PORT-${port.id} physical attachment is invalid (${attachment.code}): ${attachment.message}`,
					);
				}
			}
		}
		prospectiveChecksum = checksumRailMap(
			prospectiveMap,
			prospectiveEquipment,
			prospectiveOrganizations,
		);
		prospectiveNextAdvancedSwitchId = prospectiveMap.getAdvancedSwitchIdCursor();
		prospectiveNextPortId = prospectiveEquipment.nextPortId;
		prospectiveNextEquipmentGroupId = prospectiveEquipment.nextEquipmentGroupId;
		prospectiveNextOrganizationId = prospectiveOrganizations.nextOrganizationId;
	} catch (error) {
		const reason = caughtMessage(
			error,
			"조직 청사진 배치 plan을 prospective 상태에 적용할 수 없습니다",
		);
		return rejected(
			compactRejectedPlan(plan, reason, plan.conflicts),
			"plan",
			reason,
			plan.conflicts,
			0,
			0,
			planningMilliseconds,
			now() - validationStartedAt,
		);
	}

	try {
		const committed = compilePhysicalRail(source.map);
		const evaluation = new RailDraftEvaluator().evaluate(
			source.map,
			committed,
			plan,
			source.portEquipment,
		);
		const validationMilliseconds = now() - validationStartedAt;
		if (!evaluation.valid) {
			return rejected(
				compactRejectedPlan(plan, evaluation.reason, evaluation.conflictCells),
				evaluation.failureCode === "compile" ? "compile" : "clearance",
				evaluation.reason,
				evaluation.conflictCells,
				evaluation.candidateCommittedEnvelopePairs,
				evaluation.testedCommittedEnvelopePairs,
				planningMilliseconds,
				validationMilliseconds,
			);
		}
		const planFingerprint = staticFabOrganizationBundlePlacementFingerprint(plan);
		return Object.freeze({
			plan,
			ticket: Object.freeze({
				ticketId: request.ticketId,
				validationLevel: "exact" as const,
				sourceRevision: request.snapshot.revision,
				sourcePatchSequence: request.snapshot.sequence,
				sourceChecksum: request.snapshot.checksum,
				sourceNextAdvancedSwitchId: request.snapshot.nextAdvancedSwitchId,
				sourceNextPortId: request.snapshot.portEquipment.nextPortId,
				sourceNextEquipmentGroupId: request.snapshot.portEquipment.nextEquipmentGroupId,
				sourceNextOrganizationId: source.organizations.nextOrganizationId,
				bundleFingerprint,
				anchor: Object.freeze({ x: request.anchor.x, y: request.anchor.y }),
				quarterTurns: request.quarterTurns,
				planFingerprint,
				prospectiveChecksum,
				prospectiveNextAdvancedSwitchId,
				prospectiveNextPortId,
				prospectiveNextEquipmentGroupId,
				prospectiveNextOrganizationId,
			}),
			valid: true,
			failureCode: null,
			reason: evaluation.reason,
			conflictCells: Object.freeze([]),
			conflictCount: 0,
			candidateCommittedEnvelopePairs: evaluation.candidateCommittedEnvelopePairs,
			testedCommittedEnvelopePairs: evaluation.testedCommittedEnvelopePairs,
			planningMilliseconds,
			validationMilliseconds,
		});
	} catch (error) {
		const reason = caughtMessage(error, "조직 청사진 배치의 exact 물리 검증에 실패했습니다");
		return rejected(
			compactRejectedPlan(plan, reason, []),
			"compile",
			reason,
			[],
			0,
			0,
			planningMilliseconds,
			now() - validationStartedAt,
		);
	}
}

function rejected(
	plan: StaticFabOrganizationBundlePlacementPlan | null,
	failureCode: StaticFabOrganizationBundlePlacementFailureCode,
	reason: string,
	conflicts: readonly Cell[],
	candidateCommittedEnvelopePairs: number,
	testedCommittedEnvelopePairs: number,
	planningMilliseconds: number,
	validationMilliseconds: number,
): PreparedStaticFabOrganizationBundlePlacement {
	return Object.freeze({
		plan,
		ticket: null,
		valid: false,
		failureCode,
		reason,
		conflictCells: Object.freeze(
			sampleArray(conflicts, STATIC_FAB_ORGANIZATION_BUNDLE_CONFLICT_LIMIT).map((cell) =>
				Object.freeze({ x: cell.x, y: cell.y }),
			),
		),
		conflictCount: conflicts.length,
		candidateCommittedEnvelopePairs,
		testedCommittedEnvelopePairs,
		planningMilliseconds,
		validationMilliseconds,
	});
}

function compactRejectedPlan(
	plan: StaticFabOrganizationBundlePlacementPlan,
	reason: string,
	conflicts: readonly Cell[],
): StaticFabOrganizationBundlePlacementPlan {
	return Object.freeze({
		...plan,
		cells: Object.freeze(
			sampleArray(plan.cells, STATIC_FAB_ORGANIZATION_BUNDLE_CONFLICT_LIMIT).map((cell) =>
				Object.freeze({ x: cell.x, y: cell.y }),
			),
		),
		mutations: Object.freeze([]),
		switchMutations: Object.freeze([]),
		portMutations: Object.freeze([]),
		equipmentGroupMutations: Object.freeze([]),
		organizationMutations: Object.freeze([]),
		nextOrganizationIdAfter: plan.nextOrganizationIdBefore,
		valid: false,
		reason,
		issueCode: "topology" as const,
		conflicts: Object.freeze(
			sampleArray(conflicts, STATIC_FAB_ORGANIZATION_BUNDLE_CONFLICT_LIMIT).map((cell) =>
				Object.freeze({ x: cell.x, y: cell.y }),
			),
		),
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

function caughtMessage(error: unknown, fallback: string): string {
	return error instanceof Error && error.message ? error.message : fallback;
}
