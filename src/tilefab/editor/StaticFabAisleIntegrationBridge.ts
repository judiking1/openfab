import type { RailDocument } from "../core/RailDocument";
import {
	type StaticFabAisleIntegrationIntent,
	type StaticFabAisleIntegrationPlan,
	staticFabAisleIntegrationIntentError,
} from "../core/StaticFabAisleIntegration";
import {
	adoptStaticFabAisleIntegrationPlan,
	issueStaticFabAisleIntegrationPermit,
	revokeStaticFabAisleIntegrationPermit,
	type StaticFabAisleIntegrationPermit,
	type StaticFabAisleIntegrationScope,
	staticFabAisleIntegrationIdentity,
	staticFabAisleIntegrationIntentFingerprint,
	staticFabAisleIntegrationTransition,
} from "../core/StaticFabAisleIntegrationCertification";
import {
	checksumRailPatchResult,
	consumeRailMirrorSnapshotCaptureAuthority,
	type RailMirrorSnapshot,
} from "../worker/RailMirrorChecksum";
import type {
	DiscoveredStaticFabAisleIntegration,
	StaticFabAisleIntegrationWorkerRequest,
	StaticFabAisleIntegrationWorkerResponse,
} from "../worker/StaticFabAisleIntegrationRuntime";
import { collectTransferableBuffers } from "../worker/TransferableBuffers";

export interface StaticFabAisleIntegrationWorkerPort {
	onmessage: ((event: MessageEvent<StaticFabAisleIntegrationWorkerResponse>) => void) | null;
	onerror: ((event: ErrorEvent) => void) | null;
	onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
	postMessage(request: StaticFabAisleIntegrationWorkerRequest, transfer?: Transferable[]): void;
	terminate(): void;
}
export interface StaticFabAisleIntegrationLiveSource {
	readonly document: RailDocument;
	readonly scope: StaticFabAisleIntegrationScope;
}
interface Input {
	readonly snapshot: RailMirrorSnapshot;
	readonly getCurrentSource: () => StaticFabAisleIntegrationLiveSource;
}

/** Owns one disposable Worker and one revocable, source-bound adoption. */
export class StaticFabAisleIntegrationBridge {
	private worker: StaticFabAisleIntegrationWorkerPort | null = null;
	private reject: ((error: Error) => void) | null = null;
	private timer: ReturnType<typeof setTimeout> | null = null;
	private permit: StaticFabAisleIntegrationPermit | null = null;
	private requestId = 0;
	private readonly createWorker: () => StaticFabAisleIntegrationWorkerPort;
	private readonly timeout: number;
	constructor(
		createWorker: () => StaticFabAisleIntegrationWorkerPort = () =>
			new Worker(new URL("../worker/staticFabAisleIntegrationWorker.ts", import.meta.url), {
				type: "module",
			}),
		timeout = 30_000,
	) {
		this.createWorker = createWorker;
		this.timeout = timeout;
	}

	async discover(
		input: Input & { readonly aisleOrganizationId: number; readonly bayOrganizationId: number },
	): Promise<DiscoveredStaticFabAisleIntegration> {
		this.cancel();
		const binding = this.bind(input);
		const requestId = ++this.requestId;
		const response = await this.send({
			type: "DISCOVER_STATIC_FAB_AISLE_INTEGRATION",
			version: 1,
			requestId,
			snapshot: input.snapshot,
			aisleOrganizationId: input.aisleOrganizationId,
			bayOrganizationId: input.bayOrganizationId,
		});
		binding();
		if (this.requestId !== requestId) throw new DOMException("구역 편입 검토 취소", "AbortError");
		if (
			response.type !== "STATIC_FAB_AISLE_INTEGRATION_DISCOVERED" ||
			!response.discovered ||
			!Array.isArray(response.discovered.options) ||
			response.discovered.options.length > 8 ||
			typeof response.discovered.reason !== "string" ||
			response.discovered.reason.length > 4096
		)
			throw new Error("연결 후보 응답이 유효하지 않습니다");
		for (const option of response.discovered.options) {
			if (
				!option ||
				typeof option.id !== "string" ||
				option.id.length > 128 ||
				!Number.isFinite(option.lengthMeters) ||
				option.lengthMeters < 0 ||
				staticFabAisleIntegrationIntentError({
					version: 1,
					aisleOrganizationId: input.aisleOrganizationId,
					bayOrganizationId: input.bayOrganizationId,
					entryGateway: option.entryGateway,
					exitGateway: option.exitGateway,
				})
			)
				throw new Error("연결 위치가 유효하지 않습니다");
		}
		return response.discovered;
	}
	async prepare(
		input: Input & { readonly intent: StaticFabAisleIntegrationIntent },
	): Promise<{ readonly plan: StaticFabAisleIntegrationPlan | null; readonly reason: string }> {
		this.cancel();
		const binding = this.bind(input);
		const source = input.getCurrentSource();
		const intent = structuredClone(input.intent);
		const permit = issueStaticFabAisleIntegrationPermit(
			source.document,
			source.scope,
			intent,
			input.snapshot.checksum,
		);
		this.permit = permit;
		try {
			const response = await this.send({
				type: "PREPARE_STATIC_FAB_AISLE_INTEGRATION",
				version: 1,
				requestId: ++this.requestId,
				ticketId: permit.ticketId,
				snapshot: input.snapshot,
				intent,
				expectedSource: staticFabAisleIntegrationIdentity(source.document, input.snapshot.checksum),
				expectedIntentFingerprint: staticFabAisleIntegrationIntentFingerprint(intent),
			});
			binding();
			if (
				response.type !== "STATIC_FAB_AISLE_INTEGRATION_PREPARED" ||
				!response.prepared ||
				typeof response.prepared.valid !== "boolean" ||
				typeof response.prepared.reason !== "string" ||
				response.prepared.reason.length > 4096
			)
				throw new Error("구역 편입 응답이 유효하지 않습니다");
			const prepared = response.prepared;
			if (!prepared.valid) {
				revokeStaticFabAisleIntegrationPermit(permit);
				this.permit = null;
				return { plan: null, reason: prepared.reason };
			}
			if (
				!prepared.plan ||
				!prepared.ticket ||
				!Array.isArray(prepared.plan.draft?.mutations) ||
				prepared.plan.draft.mutations.length > 2048
			)
				throw new Error("구역 편입 인증이 없습니다");
			const expected = checksumRailPatchResult(
				input.snapshot.checksum,
				staticFabAisleIntegrationTransition(prepared.plan),
			);
			const live = input.getCurrentSource();
			const plan = adoptStaticFabAisleIntegrationPlan(
				permit,
				prepared.ticket,
				prepared.plan,
				live.document,
				live.scope,
				intent,
				expected,
			);
			return { plan, reason: prepared.reason };
		} catch (error) {
			revokeStaticFabAisleIntegrationPermit(permit);
			if (this.permit === permit) this.permit = null;
			throw error;
		}
	}
	cancel(): void {
		++this.requestId;
		const reject = this.reject;
		this.reject = null;
		this.release();
		if (this.permit) revokeStaticFabAisleIntegrationPermit(this.permit);
		this.permit = null;
		reject?.(new DOMException("구역 편입 검토 취소", "AbortError"));
	}
	dispose(): void {
		this.cancel();
	}
	private bind(input: Input): () => void {
		const source = input.getCurrentSource(),
			doc = source.document;
		const scope = { ...source.scope },
			generation = doc.map.getMutationGeneration(),
			equipment = doc.portEquipment,
			organizations = doc.organizations,
			relationships = doc.relationships;
		const identity = staticFabAisleIntegrationIdentity(doc, input.snapshot.checksum);
		if (
			!consumeRailMirrorSnapshotCaptureAuthority(
				input.snapshot,
				doc.map,
				doc.getPatchSequence(),
				equipment,
				organizations,
				relationships,
			)
		)
			throw new Error("현재 문서에서 인증된 snapshot이 필요합니다");
		return () => {
			const live = input.getCurrentSource();
			if (
				live.document !== doc ||
				live.scope.projectId !== scope.projectId ||
				live.scope.projectGeneration !== scope.projectGeneration ||
				doc.map.getMutationGeneration() !== generation ||
				doc.portEquipment !== equipment ||
				doc.organizations !== organizations ||
				doc.relationships !== relationships ||
				JSON.stringify(staticFabAisleIntegrationIdentity(doc, identity.checksum)) !==
					JSON.stringify(identity)
			)
				throw new Error("검토 중 프로젝트 또는 원본이 변경되었습니다");
		};
	}
	private send(
		request: StaticFabAisleIntegrationWorkerRequest,
	): Promise<StaticFabAisleIntegrationWorkerResponse> {
		return new Promise((resolve, reject) => {
			this.reject = reject;
			const fail = (error: Error) => {
				this.reject = null;
				this.release();
				reject(error);
			};
			try {
				const worker = this.createWorker();
				this.worker = worker;
				worker.onmessage = (event) => {
					if (this.worker !== worker) return;
					const response = event.data;
					if (
						!response ||
						response.version !== 1 ||
						response.requestId !== request.requestId ||
						this.requestId !== request.requestId
					) {
						fail(new Error("편입 Worker 응답 세대가 다릅니다"));
						return;
					}
					this.reject = null;
					this.release();
					resolve(response);
				};
				worker.onerror = (event) => fail(new Error(event.message || "편입 Worker 실패"));
				worker.onmessageerror = () => fail(new Error("편입 Worker 응답을 읽을 수 없습니다"));
				this.timer = setTimeout(
					() => fail(new Error("편입 검토 시간이 초과되었습니다")),
					this.timeout,
				);
				worker.postMessage(request, collectTransferableBuffers(request.snapshot));
			} catch (error) {
				fail(error instanceof Error ? error : new Error("편입 Worker 시작 실패"));
			}
		});
	}
	private release(): void {
		if (this.timer !== null) clearTimeout(this.timer);
		this.timer = null;
		const worker = this.worker;
		this.worker = null;
		if (worker) {
			worker.onmessage = null;
			worker.onerror = null;
			worker.onmessageerror = null;
			worker.terminate();
		}
	}
}
