import type { StaticFabSemanticFabDeleteProspectiveReview } from "../compile/StaticFabSemanticFabDeleteProspective";
import type { RailDocument } from "../core/RailDocument";
import type {
	StaticFabSemanticFabDeleteIntent,
	StaticFabSemanticFabDeletePlan,
} from "../core/StaticFabSemanticFabDelete";
import {
	adoptStaticFabSemanticFabDeleteWorkerPlan,
	issueStaticFabSemanticFabDeletePermit,
	revokeStaticFabSemanticFabDeletePermit,
	type StaticFabSemanticFabDeletePermit,
	type StaticFabSemanticFabDeleteScope,
	staticFabSemanticFabDeleteIntentFingerprint,
	staticFabSemanticFabDeleteSourceIdentitiesEqual,
	staticFabSemanticFabDeleteSourceIdentity,
} from "../core/StaticFabSemanticFabDeleteCertification";
import {
	checksumRailPatchResult,
	consumeRailMirrorSnapshotCaptureAuthority,
	type RailMirrorSnapshot,
} from "../worker/RailMirrorChecksum";
import {
	type PreparedStaticFabSemanticFabDelete,
	STATIC_FAB_SEMANTIC_FAB_DELETE_PROTOCOL_VERSION,
	type StaticFabSemanticFabDeleteWorkerRequest,
	type StaticFabSemanticFabDeleteWorkerResponse,
} from "../worker/StaticFabSemanticFabDeleteProtocol";
import { staticFabSemanticFabDeletePreparedShapeError } from "../worker/StaticFabSemanticFabDeleteResponseValidator";
import { collectTransferableBuffers } from "../worker/TransferableBuffers";

export interface StaticFabSemanticFabDeleteWorkerPort {
	onmessage: ((event: MessageEvent<StaticFabSemanticFabDeleteWorkerResponse>) => void) | null;
	onerror: ((event: ErrorEvent) => void) | null;
	onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
	postMessage(message: StaticFabSemanticFabDeleteWorkerRequest, transfer?: Transferable[]): void;
	terminate(): void;
}

export interface StaticFabSemanticFabDeleteLiveState {
	readonly document: RailDocument;
	readonly scope: StaticFabSemanticFabDeleteScope;
}

export interface StaticFabSemanticFabDeleteBridgeInput {
	readonly intent: StaticFabSemanticFabDeleteIntent;
	readonly snapshot: RailMirrorSnapshot;
	readonly getCurrentState: () => StaticFabSemanticFabDeleteLiveState;
}

export interface ValidatedStaticFabSemanticFabDelete {
	readonly plan: StaticFabSemanticFabDeletePlan | null;
	readonly validation: PreparedStaticFabSemanticFabDelete;
	readonly certified: boolean;
}

interface PendingFabDelete {
	readonly permit: StaticFabSemanticFabDeletePermit;
	readonly input: StaticFabSemanticFabDeleteBridgeInput;
	readonly source: StaticFabSemanticFabDeleteLiveState;
	readonly requestId: number;
	readonly sourceChecksum: string;
	readonly isCurrent: () => boolean;
	readonly resolve: (value: ValidatedStaticFabSemanticFabDelete) => void;
	readonly reject: (error: Error) => void;
}

/** Owns one disposable Worker and its authority until Apply or cancellation. */
export class StaticFabSemanticFabDeleteBridge {
	private worker: StaticFabSemanticFabDeleteWorkerPort | null = null;
	private pending: PendingFabDelete | null = null;
	private timeout: ReturnType<typeof setTimeout> | null = null;
	private adoptedPermit: StaticFabSemanticFabDeletePermit | null = null;
	private nextRequestId = 1;
	private readonly createWorker: () => StaticFabSemanticFabDeleteWorkerPort;
	private readonly timeoutMilliseconds: number;

	constructor(
		createWorker: () => StaticFabSemanticFabDeleteWorkerPort = () =>
			new Worker(new URL("../worker/staticFabSemanticFabDeleteWorker.ts", import.meta.url), {
				type: "module",
			}),
		timeoutMilliseconds = 30_000,
	) {
		this.createWorker = createWorker;
		this.timeoutMilliseconds = timeoutMilliseconds;
	}

	prepare(
		input: StaticFabSemanticFabDeleteBridgeInput,
	): Promise<ValidatedStaticFabSemanticFabDelete> {
		this.cancel();
		try {
			const source = input.getCurrentState();
			const document = source.document;
			const map = document.map;
			const mutationGeneration = map.getMutationGeneration();
			const portEquipment = document.portEquipment;
			const organizations = document.organizations;
			const relationships = document.relationships;
			const operationalConfiguration = document.operationalConfiguration;
			const identity = staticFabSemanticFabDeleteSourceIdentity(document, input.snapshot.checksum);
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
				throw new Error("FAB 삭제 snapshot에 현재 문서의 캡처 인증이 없습니다");
			const permit = issueStaticFabSemanticFabDeletePermit(
				document,
				source.scope,
				input.intent,
				identity.checksum,
			);
			let worker: StaticFabSemanticFabDeleteWorkerPort;
			try {
				if (!Number.isSafeInteger(this.nextRequestId))
					throw new Error("FAB 삭제 요청 순서를 초과했습니다");
				worker = this.createWorker();
			} catch (error) {
				revokeStaticFabSemanticFabDeletePermit(permit);
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
					document.operationalConfiguration === operationalConfiguration &&
					staticFabSemanticFabDeleteSourceIdentitiesEqual(
						identity,
						staticFabSemanticFabDeleteSourceIdentity(document, identity.checksum),
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
				worker.onerror = () => {
					if (this.worker === worker)
						this.fail(new Error("FAB 삭제 Worker 실행을 완료하지 못했습니다"));
				};
				worker.onmessageerror = () => {
					if (this.worker === worker)
						this.fail(new Error("FAB 삭제 Worker 응답을 읽을 수 없습니다"));
				};
				this.timeout = setTimeout(() => {
					if (this.worker === worker) this.fail(new Error("FAB 삭제 검토 시간이 초과되었습니다"));
				}, this.timeoutMilliseconds);
				try {
					worker.postMessage(
						{
							type: "PREPARE_STATIC_FAB_SEMANTIC_FAB_DELETE",
							version: STATIC_FAB_SEMANTIC_FAB_DELETE_PROTOCOL_VERSION,
							requestId,
							ticketId: permit.ticketId,
							snapshot: input.snapshot,
							operationalConfiguration,
							expectedSource: identity,
							intent: input.intent,
							expectedIntentFingerprint: staticFabSemanticFabDeleteIntentFingerprint(input.intent),
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
		this.fail(new DOMException("FAB 삭제 검토를 취소했습니다", "AbortError"));
		if (this.adoptedPermit) {
			revokeStaticFabSemanticFabDeletePermit(this.adoptedPermit);
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
				value.type !== "STATIC_FAB_SEMANTIC_FAB_DELETE_PREPARED" ||
				value.version !== STATIC_FAB_SEMANTIC_FAB_DELETE_PROTOCOL_VERSION ||
				value.requestId !== pending.requestId
			) {
				throw new Error("FAB 삭제 Worker 응답의 요청·버전이 일치하지 않습니다");
			}
			if (!pending.isCurrent())
				throw new Error("FAB 삭제 검토 중 프로젝트·문서·연결 관계 또는 운영 설정이 변경되었습니다");
			const responseError = staticFabSemanticFabDeletePreparedShapeError(value.prepared);
			if (responseError) throw new Error(responseError);
			const prepared = value.prepared as PreparedStaticFabSemanticFabDelete;
			let plan: StaticFabSemanticFabDeletePlan | null = null;
			if (!prepared.valid) revokeStaticFabSemanticFabDeletePermit(pending.permit);
			else {
				const workerPlan = prepared.plan;
				if (!workerPlan || !prepared.ticket || !evidenceIsValid(prepared.evidence, workerPlan))
					throw new Error("FAB 삭제의 표시 수치와 독립 검증 결과가 일치하지 않습니다");
				const live = pending.input.getCurrentState();
				const expectedProspectiveChecksum = checksumRailPatchResult(
					pending.sourceChecksum,
					workerPlan.transition,
				);
				plan = adoptStaticFabSemanticFabDeleteWorkerPlan(
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
			pending.resolve(Object.freeze({ plan, validation: prepared, certified: plan !== null }));
		} catch (error) {
			this.fail(asError(error));
		}
	}

	private fail(error: Error): void {
		const pending = this.pending;
		this.pending = null;
		this.releaseWorker();
		if (!pending) return;
		revokeStaticFabSemanticFabDeletePermit(pending.permit);
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
	value: StaticFabSemanticFabDeleteProspectiveReview | null,
	plan: StaticFabSemanticFabDeletePlan,
): boolean {
	if (
		!value ||
		!recordKeys(value, [
			"version",
			"targetOrganizationId",
			"sourceTopology",
			"evaluatedTopology",
			"deletedFabTopology",
			"authoredComponentDelta",
			"physicalComponentDelta",
			"portAttachmentStatus",
			"cursorStatus",
			"prospectiveDeleteProved",
		]) ||
		value.version !== 1 ||
		value.targetOrganizationId !== plan.intent.targetOrganizationId ||
		value.prospectiveDeleteProved !== true ||
		value.portAttachmentStatus !== "VALID" ||
		value.cursorStatus !== "PRESERVED"
	)
		return false;
	for (const topology of [
		value.sourceTopology,
		value.evaluatedTopology,
		value.deletedFabTopology,
	]) {
		if (
			!recordKeys(topology, [...TOPOLOGY_COUNTS, ...TOPOLOGY_FLAGS]) ||
			!TOPOLOGY_COUNTS.every((key) => nonnegative(topology[key])) ||
			!TOPOLOGY_FLAGS.every((key) => typeof topology[key] === "boolean")
		)
			return false;
	}
	const source = value.sourceTopology,
		next = value.evaluatedTopology,
		deleted = value.deletedFabTopology;
	const deletedComponents = deleted.authoredComponentCount;
	const delta = -deletedComponents;
	if (
		deletedComponents < 1 ||
		value.authoredComponentDelta !== delta ||
		value.physicalComponentDelta !== delta
	)
		return false;
	for (const key of COMPONENT_COUNTS)
		if (next[key] - source[key] !== delta || deleted[key] !== deletedComponents) return false;
	return (
		TOPOLOGY_FLAGS.every((key) => deleted[key] === true) &&
		ISSUE_COUNTS.every((key) => deleted[key] === 0 && next[key] <= source[key])
	);
}
const COMPONENT_COUNTS = [
	"authoredComponentCount",
	"authoredStrongComponentCount",
	"physicalComponentCount",
	"physicalStrongComponentCount",
] as const;
const ISSUE_COUNTS = [
	"authoredOpenTerminalCount",
	"authoredUnsafeJunctionCount",
	"physicalOpenPathCount",
	"physicalInvalidPathCount",
	"physicalDiagnosticCount",
	"physicalTerminalCount",
	"physicalClearanceIssueCount",
] as const;
const TOPOLOGY_COUNTS = [
	"authoredCellCount",
	"authoredDirectedEdgeCount",
	"physicalPathCount",
	...COMPONENT_COUNTS,
	...ISSUE_COUNTS,
] as const;
const TOPOLOGY_FLAGS = [
	"authoredComponentsClosed",
	"physicalComponentsClosed",
	"authoredPhysicalComponentMappingExact",
] as const;
function nonnegative(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) >= 0;
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
	return value instanceof Error ? value : new Error("FAB 삭제 검토를 완료하지 못했습니다");
}
