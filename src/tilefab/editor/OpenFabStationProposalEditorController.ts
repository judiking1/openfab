import type { HydratedOpenFabStationProposalArtifact } from "../compile/OpenFabStationProposalArtifact";
import type {
	MeasuredRailDocumentReviewedPortEquipmentCommit,
	RailDocument,
	RailPatchEvent,
} from "../core/RailDocument";
import type { OpenFabStationProposalFileGateway } from "../project/OpenFabStationProposalPorts";
import type { RailWorkerBridgeHandle } from "../worker/RailWorkerBridge";
import {
	OpenFabStationProposalBridge,
	OpenFabStationProposalCancelledError,
} from "./OpenFabStationProposalBridge";
import {
	OpenFabStationProposalReviewBridge,
	type OpenFabStationProposalReviewBridgeEvaluation,
	OpenFabStationProposalReviewCancelledError,
	type OpenFabStationProposalReviewReadyInvalidationHandler,
	type PreparedOpenFabStationProposalReviewApply,
} from "./OpenFabStationProposalReviewBridge";
import type { OpenFabStationProposalReviewUiPhase } from "./OpenFabStationProposalReviewPanel";
import {
	createOpenFabStationProposalReviewSession,
	type OpenFabStationProposalReviewSession,
} from "./OpenFabStationProposalReviewSession";
import type {
	OpenFabStationProposalReviewAttachmentRequest,
	OpenFabStationProposalReviewAttachmentSelection,
} from "./OpenFabStationProposalReviewUiModel";
import type { RailEditorStartupModel } from "./RailEditorStartup";

export interface OpenFabStationProposalReviewUiState {
	readonly sourceName: string;
	readonly proposal: HydratedOpenFabStationProposalArtifact;
	readonly session: OpenFabStationProposalReviewSession;
	readonly phase: OpenFabStationProposalReviewUiPhase;
	readonly evaluation: OpenFabStationProposalReviewBridgeEvaluation | null;
	readonly attachmentRequest: OpenFabStationProposalReviewAttachmentRequest | null;
	readonly attachmentSelection: OpenFabStationProposalReviewAttachmentSelection | null;
	readonly error: string | null;
	readonly generation: number;
	readonly modelGeneration: number;
	readonly document: RailDocument;
	readonly sourceRevision: number;
	readonly sourcePatchSequence: number;
}

interface StationReviewRef<Value> {
	current: Value;
}

export interface OpenFabStationProposalEditorEnvironment {
	readonly editorModelRef: StationReviewRef<
		Pick<RailEditorStartupModel, "document" | "map"> & { readonly generation: number }
	>;
	readonly modelSyncPendingRef: StationReviewRef<boolean>;
	readonly projectOperationControllerRef: StationReviewRef<AbortController | null>;
	readonly workerBridgeRef: StationReviewRef<Pick<
		RailWorkerBridgeHandle,
		"getState" | "captureCurrentSnapshot" | "prepareReviewedPortEquipmentPatchCooperatively"
	> | null>;
	readonly workerBridgeDocumentRef: StationReviewRef<RailDocument | null>;
	/** Captured from this render; retained by commands through their asynchronous work. */
	readonly startupState: { readonly status: string };
	readonly projectSession: { readonly operation: string };
	readonly stationProposalFileGateway: OpenFabStationProposalFileGateway;
	readonly blockStaticFabExclusiveCommand: () => boolean;
	readonly setStationProposalReviewState: (
		next: OpenFabStationProposalReviewUiState | null,
	) => void;
	readonly setStatus: (message: string) => void;
	readonly rememberLauncher: (launcher: HTMLButtonElement) => void;
	readonly prepareReviewUi: () => void;
	readonly onCancel: (hadReview: boolean, message?: string) => void;
	readonly activateStationProposalReviewPortTool: (
		request: OpenFabStationProposalReviewAttachmentRequest,
	) => void;
	readonly updateEditorActivity: (activity: "equip") => void;
	readonly scheduleRender: () => void;
	readonly checkpoint: () => Promise<void>;
	readonly performanceNow: () => number;
	readonly recordApplied: (
		prepared: PreparedOpenFabStationProposalReviewApply,
		commitResult: MeasuredRailDocumentReviewedPortEquipmentCommit,
		commitMilliseconds: number,
		applyStartedAt: number,
	) => void;
	readonly syncModelUi: (message: string) => unknown;
}

type StationReviewReader = Pick<OpenFabStationProposalBridge, "read" | "cancel" | "dispose">;
type StationReviewBridge = Pick<
	OpenFabStationProposalReviewBridge,
	"evaluate" | "apply" | "dispose"
>;

export interface OpenFabStationProposalEditorDependencies {
	readonly reader?: StationReviewReader;
	readonly createReviewBridge?: (
		onReadyInvalidated: OpenFabStationProposalReviewReadyInvalidationHandler,
	) => StationReviewBridge;
}

/** Owns the existing transient review lifecycle; project authority remains in RailDocument. */
export class OpenFabStationProposalEditorController {
	private readonly stationProposalReviewReadControllerRef: StationReviewRef<AbortController | null> =
		{ current: null };
	private readonly stationProposalReviewBridgeRef: StationReviewRef<StationReviewBridge | null> = {
		current: null,
	};
	private readonly stationProposalReviewGenerationRef: StationReviewRef<number> = { current: 0 };
	private readonly stationProposalBridge: StationReviewReader;
	private readonly createReviewBridge: (
		onReadyInvalidated: OpenFabStationProposalReviewReadyInvalidationHandler,
	) => StationReviewBridge;
	private disposed = false;

	// biome-ignore lint/correctness/noUnusedPrivateClassMembers: bind() reads this field through destructuring.
	private readonly stationProposalReviewUiRef: StationReviewRef<OpenFabStationProposalReviewUiState | null>;

	constructor(
		stationProposalReviewUiRef: StationReviewRef<OpenFabStationProposalReviewUiState | null>,
		dependencies: OpenFabStationProposalEditorDependencies = {},
	) {
		this.stationProposalReviewUiRef = stationProposalReviewUiRef;
		this.stationProposalBridge = dependencies.reader ?? new OpenFabStationProposalBridge();
		this.createReviewBridge =
			dependencies.createReviewBridge ??
			((onReadyInvalidated) =>
				new OpenFabStationProposalReviewBridge(
					undefined,
					undefined,
					undefined,
					undefined,
					undefined,
					onReadyInvalidated,
				));
	}

	/** Terminal owner cleanup only; App retains its existing HMR lifetime guard and UI cleanup. */
	dispose(): void {
		this.disposed = true;
		this.stationProposalReviewGenerationRef.current += 1;
		this.stationProposalReviewReadControllerRef.current?.abort();
		this.stationProposalReviewReadControllerRef.current = null;
		this.stationProposalReviewBridgeRef.current?.dispose();
		this.stationProposalReviewBridgeRef.current = null;
		this.stationProposalBridge.dispose();
	}

	/** Bind each render separately so pending commands retain their original admission closures. */
	bind(environment: OpenFabStationProposalEditorEnvironment) {
		const {
			stationProposalReviewUiRef,
			stationProposalReviewReadControllerRef,
			stationProposalReviewBridgeRef,
			stationProposalReviewGenerationRef,
			stationProposalBridge,
		} = this;
		const {
			editorModelRef,
			modelSyncPendingRef,
			projectOperationControllerRef,
			workerBridgeRef,
			workerBridgeDocumentRef,
			startupState,
			projectSession,
			stationProposalFileGateway,
			blockStaticFabExclusiveCommand,
			setStationProposalReviewState,
			setStatus,
			rememberLauncher,
			prepareReviewUi,
			onCancel,
			activateStationProposalReviewPortTool,
			updateEditorActivity,
			scheduleRender,
			checkpoint,
			performanceNow,
			recordApplied,
			syncModelUi,
		} = environment;

		const publishStationProposalReview = (
			next: OpenFabStationProposalReviewUiState | null,
		): void => {
			if (this.disposed) return;
			stationProposalReviewUiRef.current = next;
			setStationProposalReviewState(next);
		};
		const stationProposalReviewBindingIsCurrent = (
			binding: OpenFabStationProposalReviewUiState,
		): boolean => {
			const current = stationProposalReviewUiRef.current;
			const model = editorModelRef.current;
			return (
				!this.disposed &&
				current !== null &&
				current.generation === binding.generation &&
				current.session === binding.session &&
				model.generation === binding.modelGeneration &&
				model.document === binding.document &&
				model.map === binding.document.map &&
				binding.document.map.getRevision() === binding.sourceRevision &&
				binding.document.getPatchSequence() === binding.sourcePatchSequence
			);
		};
		// This remains live after an accepted commit advances the document revision and sequence.
		const stationProposalReviewOperationIsLive = (
			binding: OpenFabStationProposalReviewUiState,
			controller: AbortController,
		): boolean =>
			!this.disposed &&
			!controller.signal.aborted &&
			stationProposalReviewGenerationRef.current === binding.generation &&
			stationProposalReviewReadControllerRef.current === controller;
		const updateStationProposalReview = (
			binding: OpenFabStationProposalReviewUiState,
			patch: Partial<OpenFabStationProposalReviewUiState>,
		): OpenFabStationProposalReviewUiState | null => {
			if (!stationProposalReviewBindingIsCurrent(binding)) return null;
			const current = stationProposalReviewUiRef.current;
			if (!current) return null;
			const next = Object.freeze({ ...current, ...patch });
			publishStationProposalReview(next);
			return next;
		};
		const cancelStationProposalReview = (message?: string): void => {
			if (this.disposed) return;
			const hadReview = stationProposalReviewUiRef.current !== null;
			stationProposalReviewGenerationRef.current += 1;
			stationProposalReviewReadControllerRef.current?.abort();
			stationProposalReviewReadControllerRef.current = null;
			stationProposalBridge.cancel();
			stationProposalReviewBridgeRef.current?.dispose();
			stationProposalReviewBridgeRef.current = null;
			publishStationProposalReview(null);
			onCancel(hadReview, message);
		};

		const openStationProposalReview = async (launcher: HTMLButtonElement): Promise<void> => {
			if (this.disposed) return;
			if (blockStaticFabExclusiveCommand()) return;
			if (
				startupState.status !== "ready" ||
				modelSyncPendingRef.current ||
				projectSession.operation !== "idle" ||
				projectOperationControllerRef.current !== null
			) {
				setStatus("프로젝트와 Rail mirror가 준비된 뒤 Station proposal을 열 수 있습니다");
				return;
			}
			rememberLauncher(launcher);
			stationProposalReviewReadControllerRef.current?.abort();
			const controller = new AbortController();
			stationProposalReviewReadControllerRef.current = controller;
			const generation = Math.max(1, stationProposalReviewGenerationRef.current + 1);
			stationProposalReviewGenerationRef.current = generation;
			setStatus("OpenFab station proposal 파일을 선택하세요");
			try {
				const source = await stationProposalFileGateway.chooseOpen(controller.signal);
				if (
					!source ||
					controller.signal.aborted ||
					generation !== stationProposalReviewGenerationRef.current
				) {
					return;
				}
				setStatus(`${source.displayName} · 전용 Worker에서 스키마와 행을 검사합니다`);
				const result = await stationProposalBridge.read(
					source.bytes,
					generation,
					controller.signal,
				);
				if (controller.signal.aborted || generation !== stationProposalReviewGenerationRef.current)
					return;
				if (!result.ok) {
					setStatus(
						`Station proposal을 열지 못했습니다 · ${result.failure.code} · accepted ${result.failure.acceptedRowCount.toLocaleString()}`,
					);
					return;
				}
				const model = editorModelRef.current;
				if (
					startupState.status !== "ready" ||
					modelSyncPendingRef.current ||
					projectSession.operation !== "idle"
				) {
					setStatus("파일을 읽는 동안 프로젝트 상태가 바뀌어 Station review를 시작하지 않았습니다");
					return;
				}
				prepareReviewUi();
				const session = createOpenFabStationProposalReviewSession(result.artifact);
				const review = Object.freeze({
					sourceName: source.displayName.slice(0, 240),
					proposal: result.artifact,
					session,
					phase: "reviewing" as const,
					evaluation: null,
					attachmentRequest: null,
					attachmentSelection: null,
					error: null,
					generation,
					modelGeneration: model.generation,
					document: model.document,
					sourceRevision: model.document.map.getRevision(),
					sourcePatchSequence: model.document.getPatchSequence(),
				}) satisfies OpenFabStationProposalReviewUiState;
				publishStationProposalReview(review);
				updateEditorActivity("equip");
				setStatus(
					`Station proposal ${result.artifact.rowCount.toLocaleString()}행 · 각 행의 실제 슬롯, 방향, 그룹을 명시적으로 검토하세요`,
				);
				scheduleRender();
			} catch (openError) {
				if (
					controller.signal.aborted ||
					openError instanceof OpenFabStationProposalCancelledError ||
					(openError instanceof DOMException && openError.name === "AbortError")
				) {
					return;
				}
				setStatus(
					openError instanceof Error
						? openError.message
						: "Station proposal 파일을 열지 못했습니다",
				);
			} finally {
				if (stationProposalReviewReadControllerRef.current === controller) {
					stationProposalReviewReadControllerRef.current = null;
				}
			}
		};

		const requestStationProposalAttachment = (
			request: OpenFabStationProposalReviewAttachmentRequest,
		): void => {
			if (this.disposed) return;
			const current = stationProposalReviewUiRef.current;
			if (!current || current.phase !== "reviewing") return;
			if (!stationProposalReviewBindingIsCurrent(current)) {
				cancelStationProposalReview("프로젝트가 변경되어 Station review를 다시 열어야 합니다");
				return;
			}
			const next = updateStationProposalReview(current, {
				attachmentRequest: Object.freeze({ ...request }),
				attachmentSelection: null,
				error: null,
			});
			if (next) activateStationProposalReviewPortTool(request);
		};
		const clearStationProposalAttachment = (): void => {
			const current = stationProposalReviewUiRef.current;
			if (!current || (!current.attachmentRequest && !current.attachmentSelection)) return;
			updateStationProposalReview(current, {
				attachmentRequest: null,
				attachmentSelection: null,
				error: null,
			});
		};
		const evaluateStationProposalReview = (): void => {
			if (this.disposed) return;
			const current = stationProposalReviewUiRef.current;
			if (!current || current.phase !== "reviewing") return;
			if (!current.session.getSummary().captureReady) {
				setStatus("모든 행, 그룹, 정책을 완료한 뒤 Worker 평가를 시작하세요");
				return;
			}
			if (!stationProposalReviewBindingIsCurrent(current)) {
				cancelStationProposalReview("프로젝트가 변경되어 Station review를 다시 열어야 합니다");
				return;
			}
			const mirrorBridge = workerBridgeRef.current;
			if (
				!mirrorBridge ||
				workerBridgeDocumentRef.current !== current.document ||
				mirrorBridge.getState().status !== "ready"
			) {
				setStatus("현재 문서의 Rail mirror가 준비된 뒤 Station review를 평가하세요");
				return;
			}
			stationProposalReviewReadControllerRef.current?.abort();
			const controller = new AbortController();
			stationProposalReviewReadControllerRef.current = controller;
			stationProposalReviewBridgeRef.current?.dispose();
			const bridgeBinding: StationReviewRef<StationReviewBridge | null> = { current: null };
			const bridge = this.createReviewBridge((evaluation, error) => {
				const activeReview = stationProposalReviewUiRef.current;
				if (
					!bridgeBinding.current ||
					stationProposalReviewBridgeRef.current !== bridgeBinding.current ||
					controller.signal.aborted ||
					stationProposalReviewGenerationRef.current !== current.generation ||
					!stationProposalReviewBindingIsCurrent(current) ||
					!activeReview ||
					(activeReview.phase !== "ready" && activeReview.phase !== "evaluating") ||
					(activeReview.phase === "ready" && activeReview.evaluation !== evaluation)
				)
					return;
				// Also retire a READY result that resolved before its UI success microtask ran.
				controller.abort();
				if (stationProposalReviewReadControllerRef.current === controller) {
					stationProposalReviewReadControllerRef.current = null;
				}
				updateStationProposalReview(current, {
					phase: "reviewing",
					evaluation: null,
					error: error.message,
				});
				if (
					!stationProposalReviewBindingIsCurrent(current) ||
					stationProposalReviewGenerationRef.current !== current.generation ||
					stationProposalReviewBridgeRef.current !== bridgeBinding.current
				)
					return;
				setStatus(error.message);
			});
			bridgeBinding.current = bridge;
			stationProposalReviewBridgeRef.current = bridge;
			updateStationProposalReview(current, {
				phase: "evaluating",
				evaluation: null,
				attachmentRequest: null,
				attachmentSelection: null,
				error: null,
			});
			setStatus("현재 Rail mirror snapshot을 Station review Worker로 넘기고 있습니다");
			void mirrorBridge
				.captureCurrentSnapshot(controller.signal)
				.then((snapshot) =>
					bridge.evaluate(
						{
							document: current.document,
							proposal: current.proposal,
							snapshot,
							generation: current.generation,
							getGeneration: () =>
								stationProposalReviewBindingIsCurrent(current) ? current.generation : 0,
							draftSession: current.session,
						},
						controller.signal,
					),
				)
				.then((evaluation) => {
					if (
						!stationProposalReviewOperationIsLive(current, controller) ||
						!stationProposalReviewBindingIsCurrent(current)
					)
						return;
					updateStationProposalReview(current, {
						phase: evaluation.canApply ? "ready" : "reviewing",
						evaluation,
						error: evaluation.canApply
							? null
							: "Worker evaluation found blocking review or prospective-layout issues.",
					});
					if (
						!stationProposalReviewOperationIsLive(current, controller) ||
						stationProposalReviewBridgeRef.current !== bridge
					)
						return;
					setStatus(
						evaluation.canApply
							? `Station review READY · ${evaluation.preview.includedPortCount.toLocaleString()} ports · 명시적 APPLY가 필요합니다`
							: "Station review가 차단되었습니다 · FINAL 탭의 Worker issue를 수정하세요",
					);
				})
				.catch((evaluationError: unknown) => {
					if (
						controller.signal.aborted ||
						evaluationError instanceof OpenFabStationProposalReviewCancelledError ||
						(evaluationError instanceof DOMException && evaluationError.name === "AbortError")
					) {
						return;
					}
					if (!stationProposalReviewBindingIsCurrent(current)) return;
					const message =
						evaluationError instanceof Error
							? evaluationError.message
							: "Station review Worker evaluation failed.";
					updateStationProposalReview(current, {
						phase: "reviewing",
						evaluation: null,
						error: message,
					});
					setStatus(message);
				})
				.finally(() => {
					if (stationProposalReviewReadControllerRef.current === controller) {
						stationProposalReviewReadControllerRef.current = null;
					}
				});
		};

		const applyStationProposalReview = (): void => {
			if (this.disposed) return;
			const current = stationProposalReviewUiRef.current;
			const bridge = stationProposalReviewBridgeRef.current;
			if (!current || current.phase !== "ready" || !current.evaluation?.canApply || !bridge) {
				setStatus("Worker가 READY로 인증한 Station review만 한 번 적용할 수 있습니다");
				return;
			}
			if (!stationProposalReviewBindingIsCurrent(current)) {
				cancelStationProposalReview("프로젝트가 변경되어 Station Apply 권한을 폐기했습니다");
				return;
			}
			const controller = new AbortController();
			stationProposalReviewReadControllerRef.current = controller;
			const railWorkerBridge =
				workerBridgeDocumentRef.current === current.document ? workerBridgeRef.current : null;
			const prepareRailWorkerPatch =
				railWorkerBridge?.prepareReviewedPortEquipmentPatchCooperatively?.bind(railWorkerBridge) ??
				null;
			const applyStartedAt = performanceNow();
			updateStationProposalReview(current, { phase: "applying", error: null });
			setStatus("Station review plan을 materialize하고 exact prospective layout을 검증합니다");
			void bridge
				.apply(current.evaluation, controller.signal)
				.then(async (prepared) => {
					if (!stationProposalReviewBindingIsCurrent(current)) {
						throw new OpenFabStationProposalReviewCancelledError();
					}
					const commitStartedAt = performanceNow();
					const commitResult = await current.document.commitReviewedPortEquipmentCooperatively(
						prepared.apply,
						{
							checkpoint,
							now: performanceNow,
							sliceMilliseconds: 4,
							checkCancelled: () => {
								if (
									controller.signal.aborted ||
									!stationProposalReviewBindingIsCurrent(current) ||
									(railWorkerBridge !== null && workerBridgeRef.current !== railWorkerBridge)
								) {
									throw new OpenFabStationProposalReviewCancelledError();
								}
							},
							...(prepareRailWorkerPatch
								? {
										preparePatch: (event: RailPatchEvent, checkpoint: () => Promise<void>) =>
											prepareRailWorkerPatch(event, checkpoint),
									}
								: {}),
						},
					);
					const commitMilliseconds =
						commitResult.timings?.totalMilliseconds ?? performanceNow() - commitStartedAt;
					if (!commitResult.committed) {
						throw new Error("Station review Apply authority was rejected at commit.");
					}
					if (!stationProposalReviewOperationIsLive(current, controller)) return;
					recordApplied(prepared, commitResult, commitMilliseconds, applyStartedAt);
					const portCount = prepared.apply.portCount;
					const groupCount = prepared.apply.equipmentGroupCount;
					cancelStationProposalReview();
					syncModelUi(
						`Station proposal 적용 완료 · ${portCount.toLocaleString()} ports · ${groupCount.toLocaleString()} equipment groups · 한 번의 실행 취소 가능한 명령`,
					);
				})
				.catch((applyError: unknown) => {
					if (
						controller.signal.aborted ||
						applyError instanceof OpenFabStationProposalReviewCancelledError ||
						(applyError instanceof DOMException && applyError.name === "AbortError")
					) {
						return;
					}
					const message =
						applyError instanceof Error ? applyError.message : "Station review Apply failed.";
					const activeReview = stationProposalReviewUiRef.current;
					if (
						activeReview?.generation !== current.generation ||
						activeReview.session !== current.session
					) {
						return;
					}
					if (!stationProposalReviewBindingIsCurrent(current)) {
						cancelStationProposalReview(
							`Station Apply 원본이 변경되어 검토를 닫았습니다 · ${message}`,
						);
						syncModelUi("Station Apply 중 변경된 프로젝트를 다시 동기화했습니다");
						return;
					}
					updateStationProposalReview(current, {
						phase: "reviewing",
						evaluation: null,
						error: message,
					});
					setStatus(message);
				})
				.finally(() => {
					if (stationProposalReviewReadControllerRef.current === controller) {
						stationProposalReviewReadControllerRef.current = null;
					}
				});
		};

		return {
			stationProposalReviewBindingIsCurrent,
			updateStationProposalReview,
			cancelStationProposalReview,
			openStationProposalReview,
			requestStationProposalAttachment,
			clearStationProposalAttachment,
			evaluateStationProposalReview,
			applyStationProposalReview,
		};
	}
}
