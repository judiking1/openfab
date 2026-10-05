import type { StaticFabSemanticBankDetachProspectiveReview } from "../compile/StaticFabSemanticBankDetachProspective";
import type { RailDocument } from "../core/RailDocument";
import type {
	StaticFabSemanticBankDetachIntent,
	StaticFabSemanticBankDetachPlan,
} from "../core/StaticFabSemanticBankDetach";
import {
	adoptStaticFabSemanticBankDetachWorkerPlan,
	issueStaticFabSemanticBankDetachPermit,
	revokeStaticFabSemanticBankDetachPermit,
	type StaticFabSemanticBankDetachPermit,
	type StaticFabSemanticBankDetachScope,
	staticFabSemanticBankDetachIntentFingerprint,
	staticFabSemanticBankDetachPlanShapeError,
	staticFabSemanticBankDetachSourceIdentitiesEqual,
	staticFabSemanticBankDetachSourceIdentity,
} from "../core/StaticFabSemanticBankDetachCertification";
import {
	checksumRailPatchResult,
	consumeRailMirrorSnapshotCaptureAuthority,
	type RailMirrorSnapshot,
} from "../worker/RailMirrorChecksum";
import {
	type PreparedStaticFabSemanticBankDetach,
	STATIC_FAB_SEMANTIC_BANK_DETACH_PROTOCOL_VERSION,
	type StaticFabSemanticBankDetachWorkerRequest,
	type StaticFabSemanticBankDetachWorkerResponse,
} from "../worker/StaticFabSemanticBankDetachProtocol";
import { staticFabSemanticBankDetachPreparedShapeError } from "../worker/StaticFabSemanticBankDetachResponseValidator";
import { collectTransferableBuffers } from "../worker/TransferableBuffers";

export interface StaticFabSemanticBankDetachWorkerPort {
	onmessage: ((event: MessageEvent<StaticFabSemanticBankDetachWorkerResponse>) => void) | null;
	onerror: ((event: ErrorEvent) => void) | null;
	onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
	postMessage(message: StaticFabSemanticBankDetachWorkerRequest, transfer?: Transferable[]): void;
	terminate(): void;
}

export interface StaticFabSemanticBankDetachLiveState {
	readonly document: RailDocument;
	readonly scope: StaticFabSemanticBankDetachScope;
}

export interface StaticFabSemanticBankDetachBridgeInput {
	readonly intent: StaticFabSemanticBankDetachIntent;
	readonly snapshot: RailMirrorSnapshot;
	readonly getCurrentState: () => StaticFabSemanticBankDetachLiveState;
}

export interface ValidatedStaticFabSemanticBankDetach {
	readonly plan: StaticFabSemanticBankDetachPlan | null;
	readonly validation: PreparedStaticFabSemanticBankDetach;
	readonly certified: boolean;
}

interface PendingBankDetach {
	readonly permit: StaticFabSemanticBankDetachPermit;
	readonly input: StaticFabSemanticBankDetachBridgeInput;
	readonly source: StaticFabSemanticBankDetachLiveState;
	readonly requestId: number;
	readonly sourceChecksum: string;
	readonly isCurrent: () => boolean;
	readonly resolve: (value: ValidatedStaticFabSemanticBankDetach) => void;
	readonly reject: (error: Error) => void;
}

/** Owns one disposable Worker and its authority until Apply or cancellation. */
export class StaticFabSemanticBankDetachBridge {
	private worker: StaticFabSemanticBankDetachWorkerPort | null = null;
	private pending: PendingBankDetach | null = null;
	private timeout: ReturnType<typeof setTimeout> | null = null;
	private adoptedPermit: StaticFabSemanticBankDetachPermit | null = null;
	private nextRequestId = 1;
	private readonly createWorker: () => StaticFabSemanticBankDetachWorkerPort;
	private readonly timeoutMilliseconds: number;

	constructor(
		createWorker: () => StaticFabSemanticBankDetachWorkerPort = () =>
			new Worker(new URL("../worker/staticFabSemanticBankDetachWorker.ts", import.meta.url), {
				type: "module",
			}),
		timeoutMilliseconds = 30_000,
	) {
		this.createWorker = createWorker;
		this.timeoutMilliseconds = timeoutMilliseconds;
	}

	prepare(
		input: StaticFabSemanticBankDetachBridgeInput,
	): Promise<ValidatedStaticFabSemanticBankDetach> {
		this.cancel();
		try {
			const source = input.getCurrentState();
			const document = source.document;
			const map = document.map;
			const mutationGeneration = map.getMutationGeneration();
			const portEquipment = document.portEquipment;
			const organizations = document.organizations;
			const relationships = document.relationships;
			const identity = staticFabSemanticBankDetachSourceIdentity(document, input.snapshot.checksum);
			if (
				!consumeRailMirrorSnapshotCaptureAuthority(
					input.snapshot,
					map,
					document.getPatchSequence(),
					portEquipment,
					organizations,
					relationships,
				)
			)
				throw new Error("Bank 분리 snapshot에 현재 문서의 캡처 인증이 없습니다");
			const permit = issueStaticFabSemanticBankDetachPermit(
				document,
				source.scope,
				input.intent,
				identity.checksum,
			);
			let worker: StaticFabSemanticBankDetachWorkerPort;
			try {
				if (!Number.isSafeInteger(this.nextRequestId))
					throw new Error("Bank 분리 요청 순서를 초과했습니다");
				worker = this.createWorker();
			} catch (error) {
				revokeStaticFabSemanticBankDetachPermit(permit);
				throw error;
			}
			this.worker = worker;
			const requestId = this.nextRequestId++;
			const projectId = source.scope.projectId;
			const projectGeneration = source.scope.projectGeneration;
			const isCurrent = (): boolean => {
				const live = input.getCurrentState();
				return (
					live.document === document &&
					live.scope.projectId === projectId &&
					live.scope.projectGeneration === projectGeneration &&
					document.map === map &&
					map.getMutationGeneration() === mutationGeneration &&
					document.portEquipment === portEquipment &&
					document.organizations === organizations &&
					document.relationships === relationships &&
					staticFabSemanticBankDetachSourceIdentitiesEqual(
						identity,
						staticFabSemanticBankDetachSourceIdentity(document, identity.checksum),
					)
				);
			};
			return new Promise((resolve, reject) => {
				this.pending = {
					permit,
					input,
					source,
					requestId,
					sourceChecksum: identity.checksum,
					isCurrent,
					resolve,
					reject,
				};
				worker.onmessage = (event) => {
					if (this.worker === worker) this.receive(event.data);
				};
				worker.onerror = () => this.fail(new Error("Bank 분리 Worker 실행을 완료하지 못했습니다"));
				worker.onmessageerror = () =>
					this.fail(new Error("Bank 분리 Worker 응답을 읽을 수 없습니다"));
				this.timeout = setTimeout(
					() => this.fail(new Error("Bank 분리 검토 시간이 초과되었습니다")),
					this.timeoutMilliseconds,
				);
				try {
					worker.postMessage(
						{
							type: "PREPARE_STATIC_FAB_SEMANTIC_BANK_DETACH",
							version: STATIC_FAB_SEMANTIC_BANK_DETACH_PROTOCOL_VERSION,
							requestId,
							ticketId: permit.ticketId,
							snapshot: input.snapshot,
							expectedSource: identity,
							intent: input.intent,
							expectedIntentFingerprint: staticFabSemanticBankDetachIntentFingerprint(input.intent),
						},
						collectTransferableBuffers(input.snapshot),
					);
				} catch (error) {
					this.fail(asError(error));
				}
			});
		} catch (error) {
			return Promise.reject(asError(error));
		}
	}

	cancel(): void {
		this.fail(new DOMException("Bank 분리 검토를 취소했습니다", "AbortError"));
		if (this.adoptedPermit) {
			revokeStaticFabSemanticBankDetachPermit(this.adoptedPermit);
			this.adoptedPermit = null;
		}
	}

	dispose(): void {
		this.cancel();
	}

	private receive(value: unknown): void {
		const pending = this.pending;
		if (!pending) return;
		try {
			if (
				!recordKeys(value, ["type", "version", "requestId", "prepared"]) ||
				value.type !== "STATIC_FAB_SEMANTIC_BANK_DETACH_PREPARED" ||
				value.version !== STATIC_FAB_SEMANTIC_BANK_DETACH_PROTOCOL_VERSION ||
				value.requestId !== pending.requestId
			) {
				throw new Error("Bank 분리 Worker 응답의 요청·버전이 일치하지 않습니다");
			}
			const result = value.prepared;
			if (
				!recordKeys(result, [
					"valid",
					"failureCode",
					"reason",
					"plan",
					"review",
					"ticket",
					"evidence",
				]) ||
				typeof result.valid !== "boolean" ||
				!boundedText(result.reason)
			) {
				throw new Error("Bank 분리 Worker 응답 형식이 유효하지 않습니다");
			}
			if (!pending.isCurrent())
				throw new Error("Bank 분리 검토 중 프로젝트·문서·연결 관계가 변경되었습니다");
			let plan: StaticFabSemanticBankDetachPlan | null = null;
			if (!result.valid) {
				if (
					!boundedText(result.failureCode) ||
					[result.plan, result.review, result.ticket, result.evidence].some((item) => item !== null)
				) {
					throw new Error("Bank 분리 거부 응답에 유효하지 않은 인증 정보가 있습니다");
				}
				revokeStaticFabSemanticBankDetachPermit(pending.permit);
			} else {
				const shapeError = staticFabSemanticBankDetachPlanShapeError(result.plan);
				if (shapeError) throw new Error(shapeError);
				const prepared = result as unknown as PreparedStaticFabSemanticBankDetach;
				const workerPlan = prepared.plan as StaticFabSemanticBankDetachPlan;
				if (
					result.failureCode !== null ||
					!ticketShapeIsValid(prepared.ticket) ||
					!prepared.review ||
					staticFabSemanticBankDetachPlanShapeError({ ...workerPlan, review: prepared.review }) !==
						null ||
					JSON.stringify(prepared.review) !== JSON.stringify(workerPlan.review) ||
					!evidenceIsValid(prepared.evidence, workerPlan) ||
					checksumRailPatchResult(prepared.ticket.source.checksum, workerPlan.transition) !==
						prepared.ticket.prospective.checksum
				) {
					throw new Error("Bank 분리 영향·검증 증거·결과 checksum이 일치하지 않습니다");
				}
				const live = pending.input.getCurrentState();
				const responseError = staticFabSemanticBankDetachPreparedShapeError(prepared);
				if (responseError) throw new Error(responseError);
				const expectedProspectiveChecksum = checksumRailPatchResult(
					pending.sourceChecksum,
					workerPlan.transition,
				);
				plan = adoptStaticFabSemanticBankDetachWorkerPlan(
					pending.permit,
					prepared.ticket,
					workerPlan,
					live.document,
					live.scope,
					pending.input.intent,
					expectedProspectiveChecksum,
				);
				this.adoptedPermit = pending.permit;
			}
			this.pending = null;
			this.releaseWorker();
			pending.resolve(
				Object.freeze({
					plan,
					validation: result as unknown as PreparedStaticFabSemanticBankDetach,
					certified: plan !== null,
				}),
			);
		} catch (error) {
			this.fail(asError(error));
		}
	}

	private fail(error: Error): void {
		const pending = this.pending;
		this.pending = null;
		this.releaseWorker();
		if (!pending) return;
		revokeStaticFabSemanticBankDetachPermit(pending.permit);
		pending.reject(error);
	}

	private releaseWorker(): void {
		if (this.timeout !== null) clearTimeout(this.timeout);
		this.timeout = null;
		const worker = this.worker;
		this.worker = null;
		if (!worker) return;
		worker.onmessage = null;
		worker.onerror = null;
		worker.onmessageerror = null;
		worker.terminate();
	}
}

function evidenceIsValid(
	value: StaticFabSemanticBankDetachProspectiveReview | null,
	plan: StaticFabSemanticBankDetachPlan,
): boolean {
	if (
		!value ||
		value.version !== 1 ||
		value.action !== "DETACH" ||
		value.targetRole !== "BAY_BANK" ||
		value.targetOrganizationId !== plan.intent.targetOrganizationId ||
		value.parentFabOrganizationId !== plan.intent.expectedParentOrganizationId ||
		value.structuralCutFingerprint !== plan.review.structuralCutFingerprint ||
		value.removedDirectedEdgeCount !== plan.review.removedDirectedEdgeCount ||
		value.prospectiveDetachProved !== true ||
		!nonnegative(value.structuralCorridorCount) ||
		!nonnegative(value.sourcePortCount) ||
		!nonnegative(value.sourceEquipmentGroupCount) ||
		value.authoredComponentDelta !== 1 ||
		value.physicalComponentDelta !== 1 ||
		value.issueCode !== null ||
		value.structuralCutIssueCode !== null ||
		value.portAttachmentStatus !== "VALID" ||
		value.cursorStatus !== "PRESERVED"
	)
		return false;
	for (const topology of [value.sourceTopology, value.evaluatedTopology]) {
		if (
			!recordKeys(topology, [...TOPOLOGY_COUNTS, ...TOPOLOGY_FLAGS]) ||
			!TOPOLOGY_COUNTS.every((key) => nonnegative(topology[key])) ||
			!TOPOLOGY_FLAGS.every((key) => topology[key] === true) ||
			topology.authoredOpenTerminalCount !== 0 ||
			topology.authoredUnsafeJunctionCount !== 0 ||
			topology.physicalOpenPathCount !== 0 ||
			topology.physicalInvalidPathCount !== 0 ||
			topology.physicalDiagnosticCount !== 0 ||
			topology.physicalTerminalCount !== 0 ||
			topology.physicalClearanceIssueCount !== 0
		)
			return false;
	}
	if (
		!value.sourceTopology ||
		!value.evaluatedTopology ||
		value.evaluatedTopology.authoredComponentCount - value.sourceTopology.authoredComponentCount !==
			1 ||
		value.evaluatedTopology.physicalComponentCount - value.sourceTopology.physicalComponentCount !==
			1
	)
		return false;
	return [value.selectedBankTopology, value.retainedFabTopology].every(
		(region) =>
			recordKeys(region, [
				"closed",
				"completeModuleCoverage",
				"authoredComponentCount",
				"authoredStrongComponentCount",
				"physicalComponentCount",
				"physicalStrongComponentCount",
			]) &&
			region.closed === true &&
			region.completeModuleCoverage === true &&
			region.authoredComponentCount === 1 &&
			region.authoredStrongComponentCount === 1 &&
			region.physicalComponentCount === 1 &&
			region.physicalStrongComponentCount === 1,
	);
}

const TOPOLOGY_COUNTS = [
	"authoredCellCount",
	"authoredDirectedEdgeCount",
	"authoredComponentCount",
	"authoredStrongComponentCount",
	"authoredOpenTerminalCount",
	"authoredUnsafeJunctionCount",
	"physicalPathCount",
	"physicalComponentCount",
	"physicalStrongComponentCount",
	"physicalOpenPathCount",
	"physicalInvalidPathCount",
	"physicalDiagnosticCount",
	"physicalTerminalCount",
	"physicalClearanceIssueCount",
] as const;
const TOPOLOGY_FLAGS = [
	"authoredComponentsClosed",
	"physicalComponentsClosed",
	"authoredPhysicalComponentMappingExact",
] as const;

function ticketShapeIsValid(
	value: unknown,
): value is NonNullable<PreparedStaticFabSemanticBankDetach["ticket"]> {
	if (
		!recordKeys(value, [
			"ticketId",
			"validationLevel",
			"source",
			"prospective",
			"intentFingerprint",
			"planFingerprint",
		]) ||
		!nonnegative(value.ticketId) ||
		value.ticketId === 0 ||
		value.validationLevel !== "exact" ||
		!boundedText(value.intentFingerprint) ||
		!boundedText(value.planFingerprint)
	)
		return false;
	const counters = [
		"revision",
		"patchSequence",
		"nextAdvancedSwitchId",
		"nextPortId",
		"nextEquipmentGroupId",
		"nextOrganizationId",
		"nextRelationshipId",
	] as const;
	return [value.source, value.prospective].every(
		(source) =>
			recordKeys(source, [...counters, "checksum"]) &&
			counters.every((key) => nonnegative(source[key])) &&
			boundedText(source.checksum),
	);
}

function nonnegative(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) >= 0;
}

function boundedText(value: unknown): value is string {
	return typeof value === "string" && value.length > 0 && value.length <= 4_096;
}
function recordKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
	return (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		Object.keys(value).length === keys.length &&
		keys.every((key) => Object.hasOwn(value, key))
	);
}
function asError(value: unknown): Error {
	return value instanceof Error ? value : new Error("Bank 분리 검토를 완료하지 못했습니다");
}
