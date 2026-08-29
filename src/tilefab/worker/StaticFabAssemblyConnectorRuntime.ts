import type { CompiledPhysicalLayout } from "../compile/PhysicalRailCompiler";
import { compilePhysicalRail } from "../compile/PhysicalRailCompiler";
import { resolvePortAttachment } from "../compile/PortAttachmentResolver";
import { RailDraftEvaluator } from "../compile/RailDraftEvaluator";
import {
	planStaticFabAssemblyConnectorWithProspectiveState,
	type StaticFabAssemblyConnectorPlan,
} from "../core/StaticFabAssemblyConnector";
import {
	staticFabAssemblyConnectorIntentError,
	staticFabAssemblyConnectorIntentFingerprint,
	staticFabAssemblyConnectorPlanFingerprint,
} from "../core/StaticFabAssemblyConnectorCertification";
import type { Cell } from "../core/TileMap";
import {
	checksumRailMap,
	checksumRailPatchResult,
	type RailMirrorSnapshot,
} from "./RailMirrorChecksum";
import { hydrateRailMirrorSnapshotDocument } from "./RailMirrorSnapshotDocument";
import {
	type PrepareBoundStaticFabAssemblyConnectorRequest,
	type PreparedStaticFabAssemblyConnector,
	type PrepareStaticFabAssemblyConnectorRequest,
	STATIC_FAB_ASSEMBLY_CONNECTOR_CONFLICT_LIMIT,
	type StaticFabAssemblyConnectorFailureCode,
} from "./StaticFabAssemblyConnectorProtocol";

export type StaticFabAssemblyConnectorClock = () => number;

export interface StaticFabAssemblyConnectorRuntimeSession {
	readonly snapshot: RailMirrorSnapshot;
	readonly source: ReturnType<typeof hydrateRailMirrorSnapshotDocument>;
	readonly committedLayout: CompiledPhysicalLayout;
	readonly evaluator: RailDraftEvaluator;
}

/** Hydrate and physically compile one immutable authored generation for repeated intent previews. */
export function hydrateStaticFabAssemblyConnectorSession(
	snapshot: RailMirrorSnapshot,
): StaticFabAssemblyConnectorRuntimeSession {
	const source = hydrateRailMirrorSnapshotDocument(snapshot);
	const committedLayout = compilePhysicalRail(source.map);
	const evaluator = new RailDraftEvaluator();
	evaluator.prepare(committedLayout);
	return Object.freeze({ snapshot, source, committedLayout, evaluator });
}

/** Compatibility entry point for one isolated exact gateway-to-gateway validation. */
export function prepareStaticFabAssemblyConnector(
	request: PrepareStaticFabAssemblyConnectorRequest,
	now: StaticFabAssemblyConnectorClock = () => performance.now(),
): PreparedStaticFabAssemblyConnector {
	let session: StaticFabAssemblyConnectorRuntimeSession;
	try {
		session = hydrateStaticFabAssemblyConnectorSession(request.snapshot);
	} catch (error) {
		return rejected(
			null,
			"snapshot",
			message(error, "레일 스냅샷을 복원할 수 없습니다"),
			[],
			0,
			0,
			0,
			0,
		);
	}
	return prepareStaticFabAssemblyConnectorInSession(
		{
			...request,
			expectedSourceRevision: request.snapshot.revision,
			expectedSourcePatchSequence: request.snapshot.sequence,
			expectedSourceChecksum: request.snapshot.checksum,
			expectedSourceNextAdvancedSwitchId: request.snapshot.nextAdvancedSwitchId,
			expectedSourceNextPortId: request.snapshot.portEquipment.nextPortId,
			expectedSourceNextEquipmentGroupId: request.snapshot.portEquipment.nextEquipmentGroupId,
			expectedSourceNextOrganizationId: request.snapshot.organizations.nextOrganizationId,
		},
		session,
		now,
	);
}

/** Plan against an already hydrated Worker generation; requests contain only small intent data. */
export function prepareStaticFabAssemblyConnectorInSession(
	request: PrepareBoundStaticFabAssemblyConnectorRequest,
	session: StaticFabAssemblyConnectorRuntimeSession,
	now: StaticFabAssemblyConnectorClock = () => performance.now(),
): PreparedStaticFabAssemblyConnector {
	const { snapshot, source } = session;
	if (
		request.expectedSourceRevision !== snapshot.revision ||
		request.expectedSourcePatchSequence !== snapshot.sequence ||
		request.expectedSourceChecksum !== snapshot.checksum ||
		request.expectedSourceNextAdvancedSwitchId !== snapshot.nextAdvancedSwitchId ||
		request.expectedSourceNextPortId !== snapshot.portEquipment.nextPortId ||
		request.expectedSourceNextEquipmentGroupId !== snapshot.portEquipment.nextEquipmentGroupId ||
		request.expectedSourceNextOrganizationId !== snapshot.organizations.nextOrganizationId
	) {
		return rejected(
			null,
			"stale",
			"Worker에 고정된 FAB 세대와 연결 요청이 다릅니다",
			[],
			0,
			0,
			0,
			0,
		);
	}
	const intentError = staticFabAssemblyConnectorIntentError(request.intent);
	if (intentError) return rejected(null, "intent", intentError, [], 0, 0, 0, 0);
	let intentFingerprint: string;
	try {
		intentFingerprint = staticFabAssemblyConnectorIntentFingerprint(request.intent);
	} catch (error) {
		return rejected(
			null,
			"fingerprint",
			message(error, "연결 명령 지문을 계산할 수 없습니다"),
			[],
			0,
			0,
			0,
			0,
		);
	}
	if (intentFingerprint !== request.expectedIntentFingerprint) {
		return rejected(
			null,
			"fingerprint",
			"연결 명령이 Worker 전송 중 변경되었습니다",
			[],
			0,
			0,
			0,
			0,
		);
	}

	const planningStartedAt = now();
	const planning = planStaticFabAssemblyConnectorWithProspectiveState(
		source.map,
		source.portEquipment,
		source.getPatchSequence(),
		source.organizations,
		request.intent,
	);
	const plan = planning.plan;
	const planningMilliseconds = now() - planningStartedAt;
	if (!plan.valid) {
		return rejected(
			compactPlan(plan),
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
		plan.baseRevision !== snapshot.revision ||
		plan.basePatchSequence !== snapshot.sequence ||
		plan.nextOrganizationIdBefore !== source.organizations.nextOrganizationId
	) {
		return rejected(
			compactPlan(plan),
			"stale",
			"Assembly Connector plan과 스냅샷 세대가 일치하지 않습니다",
			[],
			0,
			0,
			planningMilliseconds,
			0,
		);
	}
	if (!planning.prospectiveState) {
		return rejected(
			compactPlan(plan),
			"plan",
			"Assembly Connector prospective 상태가 누락되었습니다",
			[],
			0,
			0,
			planningMilliseconds,
			0,
		);
	}

	const validationStartedAt = now();
	try {
		const evaluation = session.evaluator.evaluate(
			source.map,
			session.committedLayout,
			plan,
			source.portEquipment,
		);
		if (!evaluation.valid) {
			return rejected(
				compactPlan(plan),
				evaluation.failureCode === "compile" ? "compile" : "clearance",
				evaluation.reason,
				evaluation.conflictCells,
				evaluation.candidateCommittedEnvelopePairs,
				evaluation.testedCommittedEnvelopePairs,
				planningMilliseconds,
				now() - validationStartedAt,
			);
		}
		const prospective = planning.prospectiveState;
		const prospectiveLayout = compilePhysicalRail(prospective.map);
		if (prospective.portEquipment.ports.length > 0) {
			for (const port of prospective.portEquipment.ports) {
				const attachment = resolvePortAttachment(prospectiveLayout, port);
				if (!attachment.ok) {
					throw new Error(
						`PORT-${port.id} physical attachment is invalid (${attachment.code}): ${attachment.message}`,
					);
				}
			}
		}
		const prospectiveChecksum = checksumRailMap(
			prospective.map,
			prospective.portEquipment,
			prospective.organizations,
		);
		const incrementalChecksum = checksumRailPatchResult(snapshot.checksum, {
			changes: plan.mutations,
			switchChanges: plan.switchMutations ?? [],
			portChanges: [],
			equipmentGroupChanges: [],
			organizationChanges: plan.organizationMutations,
			organizationNextIdBefore: plan.nextOrganizationIdBefore,
			organizationNextIdAfter: plan.nextOrganizationIdAfter,
		});
		if (prospectiveChecksum !== incrementalChecksum) {
			throw new Error("Assembly Connector prospective checksum diverged from its atomic patch");
		}
		return Object.freeze({
			plan,
			ticket: Object.freeze({
				ticketId: request.ticketId,
				validationLevel: "exact" as const,
				sourceRevision: snapshot.revision,
				sourcePatchSequence: snapshot.sequence,
				sourceChecksum: snapshot.checksum,
				sourceNextAdvancedSwitchId: snapshot.nextAdvancedSwitchId,
				sourceNextPortId: snapshot.portEquipment.nextPortId,
				sourceNextEquipmentGroupId: snapshot.portEquipment.nextEquipmentGroupId,
				sourceNextOrganizationId: snapshot.organizations.nextOrganizationId,
				intentFingerprint,
				planFingerprint: staticFabAssemblyConnectorPlanFingerprint(plan),
				prospectiveChecksum,
				prospectiveNextAdvancedSwitchId: prospective.map.getAdvancedSwitchIdCursor(),
				prospectiveNextPortId: prospective.portEquipment.nextPortId,
				prospectiveNextEquipmentGroupId: prospective.portEquipment.nextEquipmentGroupId,
				prospectiveNextOrganizationId: prospective.organizations.nextOrganizationId,
			}),
			valid: true,
			failureCode: null,
			reason: evaluation.reason,
			conflictCells: Object.freeze([]),
			conflictCount: 0,
			candidateCommittedEnvelopePairs: evaluation.candidateCommittedEnvelopePairs,
			testedCommittedEnvelopePairs: evaluation.testedCommittedEnvelopePairs,
			planningMilliseconds,
			validationMilliseconds: now() - validationStartedAt,
		});
	} catch (error) {
		return rejected(
			compactPlan(plan),
			"compile",
			message(error, "Assembly Connector exact 검증에 실패했습니다"),
			plan.conflicts,
			0,
			0,
			planningMilliseconds,
			now() - validationStartedAt,
		);
	}
}

function compactPlan(plan: StaticFabAssemblyConnectorPlan): StaticFabAssemblyConnectorPlan {
	return Object.freeze({
		...plan,
		valid: false,
		cells: sampleCells(plan.cells),
		conflicts: sampleCells(plan.conflicts),
		mutations: Object.freeze([]),
		switchMutations: Object.freeze([]),
		organizationImpactAuthorizations: Object.freeze([]),
		organizationMutations: Object.freeze([]),
		nextOrganizationIdAfter: plan.nextOrganizationIdBefore,
	});
}

function rejected(
	plan: StaticFabAssemblyConnectorPlan | null,
	failureCode: StaticFabAssemblyConnectorFailureCode,
	reason: string,
	conflicts: readonly Cell[],
	candidateCommittedEnvelopePairs: number,
	testedCommittedEnvelopePairs: number,
	planningMilliseconds: number,
	validationMilliseconds: number,
): PreparedStaticFabAssemblyConnector {
	return Object.freeze({
		plan,
		ticket: null,
		valid: false,
		failureCode,
		reason,
		conflictCells: sampleCells(conflicts),
		conflictCount: conflicts.length,
		candidateCommittedEnvelopePairs,
		testedCommittedEnvelopePairs,
		planningMilliseconds,
		validationMilliseconds,
	});
}

function sampleCells(cells: readonly Cell[]): readonly Cell[] {
	if (cells.length <= STATIC_FAB_ASSEMBLY_CONNECTOR_CONFLICT_LIMIT) {
		return Object.freeze(cells.map((cell) => Object.freeze({ x: cell.x, y: cell.y })));
	}
	const last = cells.length - 1;
	return Object.freeze(
		Array.from({ length: STATIC_FAB_ASSEMBLY_CONNECTOR_CONFLICT_LIMIT }, (_, index) => {
			const sourceIndex = Math.floor(
				(index * last) / (STATIC_FAB_ASSEMBLY_CONNECTOR_CONFLICT_LIMIT - 1),
			);
			const cell = cells[sourceIndex] as Cell;
			return Object.freeze({ x: cell.x, y: cell.y });
		}),
	);
}

function message(error: unknown, fallback: string): string {
	return error instanceof Error && error.message ? error.message : fallback;
}
