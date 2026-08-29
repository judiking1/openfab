import {
	AlertTriangle,
	Check,
	ChevronLeft,
	ChevronRight,
	FileClock,
	FileInput,
	History,
	LoaderCircle,
	PackageCheck,
	ShieldX,
	X,
} from "lucide-react";
import {
	type ReactElement,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import type { SimulationScenarioManifest } from "../compile/SimulationScenarioManifest";
import {
	BrowserSimulationScenarioEditorFileGateway,
	type SimulationScenarioEditorFileGateway,
} from "./BrowserSimulationScenarioEditorFileGateway";
import type { BoundLiveSimulationReadinessPublication } from "./LiveSimulationReadiness";
import type {
	LiveSimulationScenarioEditorController,
	LiveSimulationScenarioEditorControllerState,
} from "./LiveSimulationScenarioEditorController";
import type { SimulationScenarioEditorRunAssetDraft } from "./SimulationScenarioEditorRunAssetFile";
import { adaptSimulationScenarioEditorSource } from "./SimulationScenarioEditorSourceAdapter";
import {
	SIMULATION_SCENARIO_MANIFEST_REVIEW_PAGE_SIZE,
	selectSimulationScenarioManifestReviewWindow,
} from "./SimulationScenarioManifestReviewWindow";

export interface ReviewedScenarioDraft {
	readonly projectId: string;
	readonly certificateFingerprint: string;
	readonly draft: SimulationScenarioEditorRunAssetDraft;
	readonly manifest: SimulationScenarioManifest;
}

export interface SimulationScenarioSourceReviewCardProps {
	readonly controller: LiveSimulationScenarioEditorController;
	readonly projectId: string;
	readonly readinessBinding: BoundLiveSimulationReadinessPublication | null;
	readonly setStatus: (message: string) => void;
	readonly fileGateway?: SimulationScenarioEditorFileGateway;
	readonly forceFileInputFallback?: boolean;
}

export function SimulationScenarioSourceReviewCard({
	controller,
	projectId,
	readinessBinding,
	setStatus,
	fileGateway,
	forceFileInputFallback = false,
}: SimulationScenarioSourceReviewCardProps): ReactElement {
	const [gateway] = useState(
		() => fileGateway ?? new BrowserSimulationScenarioEditorFileGateway({ forceFileInputFallback }),
	);
	const subscribe = useCallback(
		(listener: () => void) => controller.subscribe(listener),
		[controller],
	);
	const getSnapshot = useCallback(() => controller.getState(), [controller]);
	const controllerState = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
	const [review, setReview] = useState<ReviewedScenarioDraft | null>(null);
	const [selectingKind, setSelectingKind] = useState<"TRANSFER_PLAN" | "REPLAY_HISTORY" | null>(
		null,
	);
	const [actionError, setActionError] = useState<string | null>(null);
	const selectionRef = useRef<AbortController | null>(null);

	useEffect(
		() => () => {
			selectionRef.current?.abort();
			selectionRef.current = null;
		},
		[],
	);

	const chooseSource = useCallback(
		(sourceKind: "TRANSFER_PLAN" | "REPLAY_HISTORY"): void => {
			if (!readinessBinding || selectingKind) return;
			selectionRef.current?.abort();
			const abortController = new AbortController();
			selectionRef.current = abortController;
			setSelectingKind(sourceKind);
			setActionError(null);
			void gateway
				.chooseOpen(sourceKind, abortController.signal)
				.then((draft) => {
					if (abortController.signal.aborted || selectionRef.current !== abortController) return;
					if (!draft) return;
					const manifest = adaptSimulationScenarioEditorSource(
						readinessBinding.published,
						draft.source,
					);
					if (controller.getState().source !== null) controller.clearSource();
					setReview(
						Object.freeze({
							projectId,
							certificateFingerprint: readinessBinding.published.certificate.fingerprint,
							draft,
							manifest,
						}),
					);
					setStatus(
						`${sourceKind === "TRANSFER_PLAN" ? "Transfer Plan" : "Replay History"} 소스를 현재 인증 포트에 맞춰 검토했습니다`,
					);
				})
				.catch((error: unknown) => {
					if (isAbortError(error)) return;
					setActionError(normalizeErrorMessage(error));
					setStatus("Simulation scenario 파일을 검토하지 못했습니다");
				})
				.finally(() => {
					if (selectionRef.current !== abortController) return;
					selectionRef.current = null;
					setSelectingKind(null);
				});
		},
		[controller, gateway, projectId, readinessBinding, selectingKind, setStatus],
	);

	const prepare = useCallback((): void => {
		if (!review || !readinessBinding) return;
		if (
			review.projectId !== projectId ||
			review.certificateFingerprint !== readinessBinding.published.certificate.fingerprint
		) {
			setActionError("The reviewed scenario no longer matches the exact project certificate.");
			return;
		}
		setActionError(null);
		setStatus("검토된 simulation scenario의 안전 실행 자산을 준비합니다");
		void controller
			.prepare(
				readinessBinding.published,
				review.draft.source,
				review.draft.serviceTimingInput,
				review.draft.resourceRunInput,
			)
			.then(() => setStatus("현재 인증 소스에 대한 scenario 준비가 완료되었습니다"))
			.catch((error: unknown) => {
				if (isAbortError(error)) return;
				setActionError(normalizeErrorMessage(error));
				setStatus("Simulation scenario 준비에 실패했습니다");
			});
	}, [controller, projectId, readinessBinding, review, setStatus]);

	const clear = useCallback((): void => {
		selectionRef.current?.abort();
		selectionRef.current = null;
		setSelectingKind(null);
		setReview(null);
		setActionError(null);
		if (controller.getState().source !== null) controller.clearSource();
		setStatus("Simulation scenario의 로컬 검토 소스를 비웠습니다");
	}, [controller, setStatus]);

	const preparing = controllerState.session.phase === "PREPARING";
	const canChoose = readinessBinding !== null && !preparing && selectingKind === null;
	const visibleError =
		actionError ??
		(controllerState.session.phase === "FAILED" ? controllerState.session.message : null);
	const selectedSourceKind =
		review?.manifest.sourceKind ?? controllerState.source?.sourceKind ?? null;
	return (
		<section
			className="tilefab-simulation-source-review"
			data-testid="simulation-scenario-source-review"
			data-phase={sourceReviewPhase(controllerState, review, visibleError)}
			data-source-kind={selectedSourceKind ?? "NONE"}
			aria-label="Simulation scenario source review"
		>
			<header>
				<span>
					{sourceReviewIcon(controllerState, review, visibleError)}
					<strong>SCENARIO SOURCE</strong>
				</span>
				<small>{sourceReviewLabel(controllerState, review, visibleError)}</small>
			</header>
			<p>
				Transfer Plan은 계획 시간을, Replay History는 관측 시간을 사용합니다. 둘은 같은 포트 인증을
				쓰지만 서로 섞이지 않는 별도 검토 흐름입니다.
			</p>
			<div className="tilefab-simulation-source-actions">
				<button
					type="button"
					disabled={!canChoose}
					data-selected={selectedSourceKind === "TRANSFER_PLAN"}
					onClick={() => chooseSource("TRANSFER_PLAN")}
				>
					{selectingKind === "TRANSFER_PLAN" ? (
						<LoaderCircle size={13} className="tilefab-spin" />
					) : (
						<FileClock size={13} />
					)}
					LOAD TRANSFER PLAN
				</button>
				<button
					type="button"
					disabled={!canChoose}
					data-selected={selectedSourceKind === "REPLAY_HISTORY"}
					onClick={() => chooseSource("REPLAY_HISTORY")}
				>
					{selectingKind === "REPLAY_HISTORY" ? (
						<LoaderCircle size={13} className="tilefab-spin" />
					) : (
						<History size={13} />
					)}
					LOAD REPLAY HISTORY
				</button>
			</div>
			{review ? <ScenarioReviewFacts key={review.manifest.fingerprint} review={review} /> : null}
			{visibleError ? (
				<div className="tilefab-simulation-source-error" role="alert">
					<AlertTriangle size={13} /> <span>{visibleError}</span>
				</div>
			) : null}
			<footer>
				<small>
					{readinessBinding
						? "Local-only review. Run remains locked until a separate exact-source authorization."
						: "Certify the exact current project source before loading a scenario."}
				</small>
				{review || controllerState.source ? (
					<button type="button" className="tilefab-simulation-source-clear" onClick={clear}>
						<X size={13} /> CLEAR
					</button>
				) : null}
				<button
					type="button"
					className="tilefab-simulation-source-prepare"
					disabled={!review || !readinessBinding}
					onClick={preparing ? () => controller.cancel() : prepare}
				>
					{preparing ? <X size={13} /> : <FileInput size={13} />}
					{preparing ? "CANCEL" : "PREPARE"}
				</button>
			</footer>
		</section>
	);
}

export function ScenarioReviewFacts({
	review,
}: {
	readonly review: ReviewedScenarioDraft;
}): ReactElement {
	const { manifest } = review;
	const [recordStartIndex, setRecordStartIndex] = useState(0);
	const recordWindow = useMemo(
		() => selectSimulationScenarioManifestReviewWindow(manifest, recordStartIndex),
		[manifest, recordStartIndex],
	);
	return (
		<>
			<dl>
				<div>
					<dt>PUBLIC MANIFEST</dt>
					<dd>{manifest.manifestId}</dd>
				</div>
				<div>
					<dt>ACCEPTED / REJECTED</dt>
					<dd>
						{manifest.acceptedRecordCount.toLocaleString()} /{" "}
						{manifest.rejectedRecordCount.toLocaleString()}
					</dd>
				</div>
				<div>
					<dt>EQ TIMINGS</dt>
					<dd>{review.draft.serviceTimingInput.eqProcessTimings.length.toLocaleString()}</dd>
				</div>
				<div>
					<dt>EQ RESOURCES</dt>
					<dd>{review.draft.resourceRunInput.eqResources.length.toLocaleString()}</dd>
				</div>
				<div>
					<dt>INITIAL STORAGE LOADS</dt>
					<dd>{review.draft.resourceRunInput.initialStorageLoads.length.toLocaleString()}</dd>
				</div>
			</dl>
			<section
				className="tilefab-simulation-source-records"
				aria-label="Accepted scenario records"
				data-window-start={recordWindow.startIndex}
				data-window-end={recordWindow.endIndexExclusive}
				data-record-count={recordWindow.totalCount}
			>
				<header>
					<span>
						<strong>CANONICAL RECORDS</strong>
						<small>{manifest.sourceKind === "TRANSFER_PLAN" ? "PLAN TIME" : "OBSERVED TIME"}</small>
					</span>
					<small aria-live="polite">
						{recordWindow.totalCount === 0
							? "0 / 0"
							: `${(recordWindow.startIndex + 1).toLocaleString()}–${recordWindow.endIndexExclusive.toLocaleString()} / ${recordWindow.totalCount.toLocaleString()}`}
					</small>
				</header>
				{recordWindow.rows.length > 0 ? (
					<ol start={recordWindow.startIndex + 1}>
						{recordWindow.rows.map((record) => (
							<li key={`${record.sourceOrdinal}:${record.recordId}`}>
								<span className="tilefab-simulation-source-record-identity">
									<strong>{record.recordId}</strong>
									<small>SOURCE ROW {(record.sourceOrdinal + 1).toLocaleString()}</small>
								</span>
								<span className="tilefab-simulation-source-record-route">
									<strong>{record.loadId}</strong>
									<small>
										PORT {record.sourcePortId.toLocaleString()} →{" "}
										{record.destinationPortId.toLocaleString()}
									</small>
								</span>
								<time>{formatScenarioTime(record.timeMicroseconds)}</time>
							</li>
						))}
					</ol>
				) : (
					<p>No accepted records are available for preparation.</p>
				)}
				<footer>
					<button
						type="button"
						disabled={!recordWindow.hasPrevious}
						onClick={() =>
							setRecordStartIndex((current) =>
								Math.max(0, current - SIMULATION_SCENARIO_MANIFEST_REVIEW_PAGE_SIZE),
							)
						}
					>
						<ChevronLeft size={11} /> PREVIOUS
					</button>
					<button
						type="button"
						disabled={!recordWindow.hasNext}
						onClick={() =>
							setRecordStartIndex(
								(current) => current + SIMULATION_SCENARIO_MANIFEST_REVIEW_PAGE_SIZE,
							)
						}
					>
						NEXT <ChevronRight size={11} />
					</button>
				</footer>
			</section>
			{manifest.rejectionIssues.length > 0 ? (
				<ul className="tilefab-simulation-source-issues">
					{manifest.rejectionIssues.slice(0, 3).map((issue) => (
						<li key={`${issue.sourceOrdinal}:${issue.code}`}>
							<strong>ROW {issue.sourceOrdinal + 1}</strong>
							<span>{issue.message}</span>
						</li>
					))}
					{manifest.rejectionIssues.length > 3 || manifest.issuesTruncated ? (
						<li>
							<strong>BOUNDED</strong>
							<span>Additional rejection details are intentionally not retained here.</span>
						</li>
					) : null}
				</ul>
			) : null}
		</>
	);
}

function formatScenarioTime(microseconds: number): string {
	const seconds = microseconds / 1_000_000;
	return `${seconds.toLocaleString(undefined, { maximumFractionDigits: 6 })} s`;
}

function sourceReviewPhase(
	state: LiveSimulationScenarioEditorControllerState,
	review: ReviewedScenarioDraft | null,
	error: string | null,
): string {
	if (error || state.session.phase === "FAILED") return "error";
	if (!review && state.source === null) return "empty";
	if (review && state.source === null) return "reviewed";
	if (state.session.phase === "PREPARING") return "preparing";
	if (state.session.phase === "PREPARED") return "prepared";
	if (state.session.phase === "INVALIDATED") return "invalidated";
	return review ? "reviewed" : "empty";
}

function sourceReviewLabel(
	state: LiveSimulationScenarioEditorControllerState,
	review: ReviewedScenarioDraft | null,
	error: string | null,
): string {
	if (error || state.session.phase === "FAILED") return "NEEDS REVIEW";
	if (!review && state.source === null) return "NO LOCAL SOURCE";
	if (review && state.source === null) return "REVIEWED";
	if (state.session.phase === "PREPARING") return "PREPARING";
	if (state.session.phase === "PREPARED") return "PREPARED · RUN LOCKED";
	if (state.session.phase === "INVALIDATED") return `INVALIDATED · ${state.session.reason}`;
	return review ? "REVIEWED" : "NO LOCAL SOURCE";
}

function sourceReviewIcon(
	state: LiveSimulationScenarioEditorControllerState,
	review: ReviewedScenarioDraft | null,
	error: string | null,
): ReactElement {
	if (error || state.session.phase === "FAILED") return <AlertTriangle size={15} />;
	if (!review && state.source === null) return <FileInput size={15} />;
	if (review && state.source === null) return <Check size={15} />;
	if (state.session.phase === "PREPARING") {
		return <LoaderCircle size={15} className="tilefab-spin" />;
	}
	if (state.session.phase === "PREPARED") return <PackageCheck size={15} />;
	if (state.session.phase === "INVALIDATED") return <ShieldX size={15} />;
	return <Check size={15} />;
}

function normalizeErrorMessage(error: unknown): string {
	if (!(error instanceof Error) || error.message.length === 0) {
		return "Simulation scenario review failed.";
	}
	return error.message.slice(0, 240);
}

function isAbortError(error: unknown): boolean {
	return error instanceof DOMException && error.name === "AbortError";
}
