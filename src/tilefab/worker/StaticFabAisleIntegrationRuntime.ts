import { analyzePhysicalPathTopology } from "../compile/PhysicalPathTopology";
import { compilePhysicalRail } from "../compile/PhysicalRailCompiler";
import { resolvePortAttachment } from "../compile/PortAttachmentResolver";
import { assertPortSlotCapacity } from "../compile/PortSlotCompiler";
import { assertPortEquipmentLayout } from "../core/PortEquipmentLayoutValidator";
import {
	discoverStaticFabAisleIntegrationOptions,
	planStaticFabAisleIntegration,
	type StaticFabAisleIntegrationIntent,
	type StaticFabAisleIntegrationOption,
	type StaticFabAisleIntegrationPlan,
	staticFabAisleIntegrationComponentMap,
	staticFabAisleIntegrationIntentError,
} from "../core/StaticFabAisleIntegration";
import {
	type StaticFabAisleIntegrationIdentity,
	type StaticFabAisleIntegrationTicket,
	staticFabAisleIntegrationIdentity,
	staticFabAisleIntegrationIntentFingerprint,
	staticFabAisleIntegrationPlanFingerprint,
	staticFabAisleIntegrationTransition,
} from "../core/StaticFabAisleIntegrationCertification";
import type { Cell } from "../core/TileMap";
import {
	checksumRailMap,
	checksumRailPatchResult,
	type RailMirrorSnapshot,
} from "./RailMirrorChecksum";
import {
	hydrateStaticFabAssemblyConnectorSession,
	type StaticFabAssemblyConnectorRuntimeSession,
} from "./StaticFabAssemblyConnectorRuntime";

export interface PrepareStaticFabAisleIntegrationRequest {
	readonly type: "PREPARE_STATIC_FAB_AISLE_INTEGRATION";
	readonly version: 1;
	readonly requestId: number;
	readonly ticketId: number;
	readonly snapshot: RailMirrorSnapshot;
	readonly intent: StaticFabAisleIntegrationIntent;
	readonly expectedSource: StaticFabAisleIntegrationIdentity;
	readonly expectedIntentFingerprint: string;
}
export interface PreparedStaticFabAisleIntegration {
	readonly valid: boolean;
	readonly reason: string;
	readonly plan: StaticFabAisleIntegrationPlan | null;
	readonly ticket: StaticFabAisleIntegrationTicket | null;
	readonly conflicts: readonly Cell[];
}
export interface StaticFabAisleIntegrationResponse {
	readonly type: "STATIC_FAB_AISLE_INTEGRATION_PREPARED";
	readonly version: 1;
	readonly requestId: number;
	readonly prepared: PreparedStaticFabAisleIntegration;
}

/** The existing Connector hydration/evaluator is reused, never its closed-assembly authority. */
export function prepareStaticFabAisleIntegration(
	request: PrepareStaticFabAisleIntegrationRequest,
	hydrated?: StaticFabAssemblyConnectorRuntimeSession,
): PreparedStaticFabAisleIntegration {
	let plan: StaticFabAisleIntegrationPlan | null = null;
	try {
		if (
			request.type !== "PREPARE_STATIC_FAB_AISLE_INTEGRATION" ||
			request.version !== 1 ||
			!Number.isSafeInteger(request.requestId) ||
			request.requestId <= 0 ||
			!Number.isSafeInteger(request.ticketId) ||
			request.ticketId <= 0
		)
			throw new Error("구역 편입 Worker 요청이 유효하지 않습니다");
		const error = staticFabAisleIntegrationIntentError(request.intent);
		if (error) throw new Error(error);
		const fingerprint = staticFabAisleIntegrationIntentFingerprint(request.intent);
		if (fingerprint !== request.expectedIntentFingerprint)
			throw new Error("구역 편입 요청이 변경되었습니다");
		const session = hydrated ?? hydrateStaticFabAssemblyConnectorSession(request.snapshot);
		const document = session.source;
		const sourceIdentity = staticFabAisleIntegrationIdentity(document, request.snapshot.checksum);
		if (JSON.stringify(sourceIdentity) !== JSON.stringify(request.expectedSource))
			throw new Error("구역 편입 원본 세대가 다릅니다");
		assertPortEquipmentLayout(document.map, document.portEquipment);
		for (const port of document.portEquipment.ports) {
			const attachment = resolvePortAttachment(session.committedLayout, port);
			if (!attachment.ok)
				throw new Error(`PORT-${port.id} 원본 연결이 유효하지 않습니다 · ${attachment.message}`);
		}
		const planned = planStaticFabAisleIntegration(
			document,
			document.getPatchSequence(),
			request.intent,
		);
		plan = planned.plan;
		if (!plan.valid || !planned.prospective) return rejected(plan.reason, plan, plan.conflicts);
		const prospective = planned.prospective;
		const evaluation = session.evaluator.evaluate(
			document.map,
			session.committedLayout,
			plan.draft,
			document.portEquipment,
		);
		if (!evaluation.valid) return rejected(evaluation.reason, plan, evaluation.conflictCells);
		assertPortEquipmentLayout(prospective.map, prospective.portEquipment);
		const layout = compilePhysicalRail(prospective.map);
		assertPortSlotCapacity(layout);
		for (const port of prospective.portEquipment.ports) {
			const attachment = resolvePortAttachment(layout, port);
			if (!attachment.ok)
				return rejected(
					`PORT-${port.id} 연결을 유지할 수 없습니다 · ${attachment.message}`,
					plan,
					port.route.kind === "CARDINAL_CELL" ? [{ x: port.route.x, y: port.route.z }] : [],
				);
		}
		const bayComponent = compilePhysicalRail(
			staticFabAisleIntegrationComponentMap(prospective.map, request.intent.entryGateway),
		);
		const topology = analyzePhysicalPathTopology(bayComponent.paths);
		if (
			!bayComponent.valid ||
			bayComponent.clearance.issues.count ||
			topology.openPaths ||
			topology.invalidPaths ||
			topology.strongComponents !== 1
		)
			throw new Error("편입 후 Bay의 물리 순환망 검증을 통과하지 못했습니다");
		const prospectiveChecksum = checksumRailMap(
			prospective.map,
			prospective.portEquipment,
			prospective.organizations,
			prospective.relationships,
		);
		if (
			prospectiveChecksum !==
			checksumRailPatchResult(sourceIdentity.checksum, staticFabAisleIntegrationTransition(plan))
		)
			throw new Error("구역 편입 원자적 변경 checksum이 다릅니다");
		return {
			valid: true,
			reason: "두 연결 검증 완료",
			plan,
			conflicts: [],
			ticket: {
				ticketId: request.ticketId,
				validationLevel: "exact",
				source: sourceIdentity,
				prospective: {
					...sourceIdentity,
					revision: sourceIdentity.revision + plan.draft.mutations.length,
					patchSequence: sourceIdentity.patchSequence + 1,
					checksum: prospectiveChecksum,
				},
				intentFingerprint: fingerprint,
				planFingerprint: staticFabAisleIntegrationPlanFingerprint(plan),
			},
		};
	} catch (error) {
		return rejected(
			error instanceof Error ? error.message : "구역 편입 검증 실패",
			plan,
			plan?.conflicts ?? [],
		);
	}
}
function rejected(
	reason: string,
	plan: StaticFabAisleIntegrationPlan | null,
	conflicts: readonly Cell[],
): PreparedStaticFabAisleIntegration {
	return {
		valid: false,
		reason: reason.slice(0, 4_096),
		ticket: null,
		conflicts: conflicts.slice(0, 128),
		plan: plan
			? {
					...plan,
					valid: false,
					reason,
					conflicts,
					draft: { ...plan.draft, valid: false, mutations: [], reason, conflicts },
					organizationMutations: [],
					organizationImpactAuthorizations: [],
				}
			: null,
	};
}

export interface DiscoverStaticFabAisleIntegrationRequest {
	readonly type: "DISCOVER_STATIC_FAB_AISLE_INTEGRATION";
	readonly version: 1;
	readonly requestId: number;
	readonly snapshot: RailMirrorSnapshot;
	readonly aisleOrganizationId: number;
	readonly bayOrganizationId: number;
}
export interface DiscoveredStaticFabAisleIntegration {
	readonly options: readonly StaticFabAisleIntegrationOption[];
	readonly reason: string;
}
export type StaticFabAisleIntegrationWorkerRequest =
	| PrepareStaticFabAisleIntegrationRequest
	| DiscoverStaticFabAisleIntegrationRequest;
export type StaticFabAisleIntegrationWorkerResponse =
	| StaticFabAisleIntegrationResponse
	| {
			readonly type: "STATIC_FAB_AISLE_INTEGRATION_DISCOVERED";
			readonly version: 1;
			readonly requestId: number;
			readonly discovered: DiscoveredStaticFabAisleIntegration;
	  };
/** Candidate search is off-thread and grants no adoption authority. */
export function discoverStaticFabAisleIntegration(
	request: DiscoverStaticFabAisleIntegrationRequest,
): DiscoveredStaticFabAisleIntegration {
	try {
		if (
			request.type !== "DISCOVER_STATIC_FAB_AISLE_INTEGRATION" ||
			request.version !== 1 ||
			!Number.isSafeInteger(request.requestId) ||
			request.requestId <= 0
		)
			throw new Error("연결 후보 요청이 유효하지 않습니다");
		const session = hydrateStaticFabAssemblyConnectorSession(request.snapshot);
		const options: StaticFabAisleIntegrationOption[] = [];
		for (const option of discoverStaticFabAisleIntegrationOptions(
			session.source,
			request.aisleOrganizationId,
			request.bayOrganizationId,
		)) {
			const intent: StaticFabAisleIntegrationIntent = {
				version: 1,
				aisleOrganizationId: request.aisleOrganizationId,
				bayOrganizationId: request.bayOrganizationId,
				entryGateway: option.entryGateway,
				exitGateway: option.exitGateway,
			};
			const result = prepareStaticFabAisleIntegration(
				{
					type: "PREPARE_STATIC_FAB_AISLE_INTEGRATION",
					version: 1,
					requestId: request.requestId,
					ticketId: 1,
					snapshot: request.snapshot,
					intent,
					expectedSource: staticFabAisleIntegrationIdentity(
						session.source,
						request.snapshot.checksum,
					),
					expectedIntentFingerprint: staticFabAisleIntegrationIntentFingerprint(intent),
				},
				session,
			);
			if (result.valid) options.push(option);
			if (options.length === 8) break;
		}
		return {
			options,
			reason: options.length
				? "연결 위치를 선택하세요"
				: "두 연결을 함께 만들 수 있는 위치가 없습니다",
		};
	} catch (error) {
		return {
			options: [],
			reason: (error instanceof Error ? error.message : "연결 후보 검색 실패").slice(0, 4096),
		};
	}
}
