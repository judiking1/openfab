import { compilePhysicalRail } from "../compile/PhysicalRailCompiler";
import { resolvePortAttachment } from "../compile/PortAttachmentResolver";
import { compilePortEquipmentPresentation } from "../compile/PortEquipmentPresentation";
import { additionalStaticFabArrangementClearanceCells } from "../compile/StaticFabArrangementClearance";
import { resolveStaticFabArrangementCommand } from "../compile/StaticFabArrangementCommandResolver";
import { planStaticFabArrangement } from "../compile/StaticFabArrangementPlanner";
import { applyPortEquipmentMutations, portEquipmentStateError } from "../core/EquipmentGroup";
import { portEquipmentLayoutError } from "../core/PortEquipmentLayoutValidator";
import { buildRailModuleOwnershipIndex } from "../core/RailModuleOwnership";
import { solveStaticFabArrangement } from "../core/StaticFabArrangement";
import { staticFabArrangementPlanFingerprint } from "../core/StaticFabArrangementCertification";
import {
	prepareStaticFabArrangementCommand,
	staticFabArrangementCommandFingerprint,
} from "../core/StaticFabArrangementCommand";
import type { StaticFabArrangementPlan } from "../core/StaticFabArrangementPlan";
import {
	applyStaticFabOrganizationMutations,
	staticFabOrganizationStateError,
} from "../core/StaticFabOrganization";
import type { Cell } from "../core/TileMap";
import { checksumRailMap } from "./RailMirrorChecksum";
import { hydrateRailMirrorSnapshotDocument } from "./RailMirrorSnapshotDocument";
import {
	type PreparedStaticFabArrangement,
	type PrepareStaticFabArrangementRequest,
	STATIC_FAB_ARRANGEMENT_CONFLICT_LIMIT,
	type StaticFabArrangementFailureCode,
	type StaticFabArrangementSessionSourceIdentity,
} from "./StaticFabArrangementProtocol";

export type StaticFabArrangementClock = () => number;

export interface StaticFabArrangementRuntimeSession {
	readonly source: ReturnType<typeof hydrateRailMirrorSnapshotDocument>;
	readonly sourceLayout: ReturnType<typeof compilePhysicalRail>;
	readonly sourcePresentation: ReturnType<typeof compilePortEquipmentPresentation>;
	readonly ownership: ReturnType<typeof buildRailModuleOwnershipIndex>;
	readonly sourceIdentity: StaticFabArrangementSessionSourceIdentity;
	preparedCount: number;
}

export interface InitializedStaticFabArrangementRuntimeSession {
	readonly session: StaticFabArrangementRuntimeSession;
	readonly source: StaticFabArrangementSessionSourceIdentity;
	readonly hydrationMilliseconds: number;
	readonly compilationMilliseconds: number;
}

export interface StaticFabArrangementSessionPreparation {
	readonly prepared: PreparedStaticFabArrangement;
	readonly sourcePlanIndex: number;
}

/** Hydrate and compile one immutable authored source for the lifetime of a disposable Worker. */
export function initializeStaticFabArrangementRuntimeSession(
	snapshot: Parameters<typeof hydrateRailMirrorSnapshotDocument>[0],
	now: StaticFabArrangementClock = () => performance.now(),
): InitializedStaticFabArrangementRuntimeSession {
	const hydrationStartedAt = now();
	let source: ReturnType<typeof hydrateRailMirrorSnapshotDocument>;
	try {
		source = hydrateRailMirrorSnapshotDocument(snapshot);
	} catch (error) {
		throw new Error(message(error, "정렬 스냅샷을 복원할 수 없습니다"));
	}
	const hydrationMilliseconds = now() - hydrationStartedAt;
	const compilationStartedAt = now();
	let sourceLayout: ReturnType<typeof compilePhysicalRail>;
	let sourcePresentation: ReturnType<typeof compilePortEquipmentPresentation>;
	let ownership: ReturnType<typeof buildRailModuleOwnershipIndex>;
	try {
		sourceLayout = compilePhysicalRail(source.map);
		sourcePresentation = compilePortEquipmentPresentation(sourceLayout, source.portEquipment);
		ownership = buildRailModuleOwnershipIndex(source.map);
	} catch (error) {
		throw new Error(message(error, "정렬 원본의 레일·장비 footprint를 컴파일할 수 없습니다"));
	}
	const sourceIdentity: StaticFabArrangementSessionSourceIdentity = Object.freeze({
		revision: snapshot.revision,
		sequence: snapshot.sequence,
		checksum: snapshot.checksum,
		nextAdvancedSwitchId: snapshot.nextAdvancedSwitchId,
		nextPortId: snapshot.portEquipment.nextPortId,
		nextEquipmentGroupId: snapshot.portEquipment.nextEquipmentGroupId,
		nextOrganizationId: snapshot.organizations.nextOrganizationId,
	});
	return Object.freeze({
		session: {
			source,
			sourceLayout,
			sourcePresentation,
			ownership,
			sourceIdentity,
			preparedCount: 0,
		},
		source: sourceIdentity,
		hydrationMilliseconds,
		compilationMilliseconds: now() - compilationStartedAt,
	});
}

/** Re-resolve, plan, and exactly validate one candidate against a reusable immutable source. */
export function prepareStaticFabArrangementInSession(
	session: StaticFabArrangementRuntimeSession,
	request: PrepareStaticFabArrangementRequest,
	now: StaticFabArrangementClock = () => performance.now(),
): StaticFabArrangementSessionPreparation {
	const sourcePlanIndex = session.preparedCount + 1;
	session.preparedCount = sourcePlanIndex;
	return Object.freeze({
		sourcePlanIndex,
		prepared: prepareStaticFabArrangementCandidate(session, request, now),
	});
}

function prepareStaticFabArrangementCandidate(
	session: StaticFabArrangementRuntimeSession,
	request: PrepareStaticFabArrangementRequest,
	now: StaticFabArrangementClock,
): PreparedStaticFabArrangement {
	const { source, sourceLayout, sourcePresentation, ownership, sourceIdentity } = session;
	const preparedCommand = prepareStaticFabArrangementCommand(request.intent);
	if (!preparedCommand.valid) {
		return rejected(null, "selection", preparedCommand.reason, [], 0, 0);
	}
	let intentFingerprint: string;
	try {
		intentFingerprint = staticFabArrangementCommandFingerprint(preparedCommand.intent);
	} catch (error) {
		return rejected(
			null,
			"fingerprint",
			message(error, "정렬 명령 지문을 계산할 수 없습니다"),
			[],
			0,
			0,
		);
	}
	if (intentFingerprint !== request.expectedIntentFingerprint) {
		return rejected(null, "fingerprint", "정렬 명령이 Worker 전송 중 변경되었습니다", [], 0, 0);
	}

	const planningStartedAt = now();
	const resolution = resolveStaticFabArrangementCommand(
		source.map,
		ownership,
		source.portEquipment,
		source.getPatchSequence(),
		source.organizations,
		preparedCommand.intent,
		sourcePresentation,
	);
	if (!resolution.valid) {
		return rejected(null, "selection", resolution.reason, [], now() - planningStartedAt, 0);
	}
	const arrangement = solveStaticFabArrangement({
		version: preparedCommand.intent.arrangementVersion,
		axis: preparedCommand.intent.axis,
		mode: preparedCommand.intent.mode,
		roots: resolution.roots,
	});
	const plan = planStaticFabArrangement(
		source.map,
		ownership,
		source.portEquipment,
		source.organizations,
		source.getPatchSequence(),
		resolution.roots,
		arrangement,
	);
	const planningMilliseconds = now() - planningStartedAt;
	if (!plan.valid) {
		return rejected(
			compactPlan(plan),
			"plan",
			plan.reason,
			plan.conflicts,
			planningMilliseconds,
			0,
		);
	}

	const validationStartedAt = now();
	try {
		const prospectiveMap = source.map.clone();
		if (!prospectiveMap.applyAtomicMutations(plan.mutations, plan.switchMutations)) {
			throw new Error("정렬 mutation이 스냅샷의 before 상태와 일치하지 않습니다");
		}
		const prospectiveEquipment = applyPortEquipmentMutations(
			source.portEquipment,
			plan.portMutations,
			plan.equipmentGroupMutations,
		);
		const equipmentStateIssue = portEquipmentStateError(prospectiveEquipment);
		if (equipmentStateIssue) throw new Error(equipmentStateIssue);
		const equipmentLayoutIssue = portEquipmentLayoutError(prospectiveMap, prospectiveEquipment);
		if (equipmentLayoutIssue) throw new Error(equipmentLayoutIssue);
		const prospectiveOrganizations = applyStaticFabOrganizationMutations(
			source.organizations,
			plan.organizationMutations,
			plan.nextOrganizationIdAfter,
		);
		const organizationIssue = staticFabOrganizationStateError(
			prospectiveMap,
			prospectiveEquipment,
			prospectiveOrganizations,
		);
		if (organizationIssue) throw new Error(organizationIssue);
		const prospectiveLayout = compilePhysicalRail(prospectiveMap);
		for (const port of prospectiveEquipment.ports) {
			const attachment = resolvePortAttachment(prospectiveLayout, port);
			if (!attachment.ok) {
				throw new Error(
					`PORT-${port.id} physical attachment is invalid (${attachment.code}): ${attachment.message}`,
				);
			}
		}
		const newClearanceCells = additionalStaticFabArrangementClearanceCells(
			sourceLayout,
			prospectiveLayout,
		);
		if (newClearanceCells.length > 0) {
			return rejected(
				compactPlan(plan),
				"clearance",
				"정렬 후 기존에 없던 레일 물리 간섭이 생깁니다",
				newClearanceCells,
				planningMilliseconds,
				now() - validationStartedAt,
			);
		}
		const prospectiveChecksum = checksumRailMap(
			prospectiveMap,
			prospectiveEquipment,
			prospectiveOrganizations,
			source.relationships,
		);
		return Object.freeze({
			plan,
			ticket: Object.freeze({
				ticketId: request.ticketId,
				validationLevel: "exact" as const,
				sourceRevision: sourceIdentity.revision,
				sourcePatchSequence: sourceIdentity.sequence,
				sourceChecksum: sourceIdentity.checksum,
				sourceNextAdvancedSwitchId: sourceIdentity.nextAdvancedSwitchId,
				sourceNextPortId: sourceIdentity.nextPortId,
				sourceNextEquipmentGroupId: sourceIdentity.nextEquipmentGroupId,
				sourceNextOrganizationId: sourceIdentity.nextOrganizationId,
				intentFingerprint,
				planFingerprint: staticFabArrangementPlanFingerprint(plan),
				prospectiveChecksum,
				prospectiveNextAdvancedSwitchId: prospectiveMap.getAdvancedSwitchIdCursor(),
				prospectiveNextPortId: prospectiveEquipment.nextPortId,
				prospectiveNextEquipmentGroupId: prospectiveEquipment.nextEquipmentGroupId,
				prospectiveNextOrganizationId: prospectiveOrganizations.nextOrganizationId,
			}),
			valid: true,
			failureCode: null,
			reason: plan.reason,
			conflictCells: Object.freeze([]),
			conflictCount: 0,
			planningMilliseconds,
			validationMilliseconds: now() - validationStartedAt,
		});
	} catch (error) {
		return rejected(
			compactPlan(plan),
			"compile",
			message(error, "정렬 prospective 상태의 exact 검증에 실패했습니다"),
			plan.conflicts,
			planningMilliseconds,
			now() - validationStartedAt,
		);
	}
}

function compactPlan(plan: StaticFabArrangementPlan): StaticFabArrangementPlan {
	return Object.freeze({
		...plan,
		cells: sampleCells(plan.cells),
		conflicts: sampleCells(plan.conflicts),
		mutations: Object.freeze([]),
		switchMutations: Object.freeze([]),
		portMutations: Object.freeze([]),
		equipmentGroupMutations: Object.freeze([]),
		organizationMutations: Object.freeze([]),
		organizationImpactAuthorizations: Object.freeze([]),
		valid: false,
		arrangement: null,
	});
}

function rejected(
	plan: StaticFabArrangementPlan | null,
	failureCode: StaticFabArrangementFailureCode,
	reason: string,
	conflicts: readonly Cell[],
	planningMilliseconds: number,
	validationMilliseconds: number,
): PreparedStaticFabArrangement {
	return Object.freeze({
		plan,
		ticket: null,
		valid: false,
		failureCode,
		reason,
		conflictCells: sampleCells(conflicts),
		conflictCount: conflicts.length,
		planningMilliseconds,
		validationMilliseconds,
	});
}

function sampleCells(cells: readonly Cell[]): readonly Cell[] {
	if (cells.length <= STATIC_FAB_ARRANGEMENT_CONFLICT_LIMIT) {
		return Object.freeze(cells.map((cell) => Object.freeze({ x: cell.x, y: cell.y })));
	}
	const last = cells.length - 1;
	return Object.freeze(
		Array.from({ length: STATIC_FAB_ARRANGEMENT_CONFLICT_LIMIT }, (_, index) => {
			const cell = cells[
				Math.floor((index * last) / (STATIC_FAB_ARRANGEMENT_CONFLICT_LIMIT - 1))
			] as Cell;
			return Object.freeze({ x: cell.x, y: cell.y });
		}),
	);
}

function message(error: unknown, fallback: string): string {
	return error instanceof Error && error.message ? error.message : fallback;
}
